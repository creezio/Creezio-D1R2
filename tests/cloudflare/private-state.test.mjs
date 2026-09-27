import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createTargetVault} from '../../scripts/cloudflare/target-vault.mjs';
import {createLocalControlJournal} from '../../scripts/cloudflare/local-journal.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
async function fixture(t){
  const parent=path.join(root,'.quality');await mkdir(parent,{recursive:true});
  const directory=await mkdtemp(path.join(parent,'t32-private-test-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));return directory;
}
test('target vault reuses the exact key after reopen and refuses a corrupted retained key',async t=>{
  const directory=await fixture(t),vault=createTargetVault(directory);
  const first=await vault.loadOrCreate('transfer-one');
  const context={moduleId:'creezio.openai',contextId:'application',bindingId:'openai.responses.v1',
    reference:'creezio-secret:v1:11111111-1111-4111-8111-111111111111',version:1};
  const encrypted=await first.keyring.seal(context,'test-provider-value');
  const second=await createTargetVault(directory).loadOrCreate('transfer-one');
  assert.equal(await second.keyring.open(context,encrypted),'test-provider-value');
  assert.equal(first.secretsPath,second.secretsPath);
  assert.equal((await readFile(first.secretsPath,'utf8')).includes('test-provider-value'),false);
  await writeFile(first.secretsPath,'{}');
  await assert.rejects(()=>vault.loadOrCreate('transfer-one'),{code:'vault_unavailable'});
  await assert.rejects(()=>vault.loadOrCreate('../escape'),{code:'vault_unavailable'});
});
test('control journal compare-and-save excludes a concurrent writer and preserves the winning plan',async t=>{
  const directory=await fixture(t),journal=createLocalControlJournal(directory,'plan');
  const first={schemaVersion:1,revision:1,transferId:'one',stage:'prepared'};
  await journal.create(first);
  const second={...first,revision:2,stage:'capturing'},third={...first,revision:2,stage:'other'};
  const results=await Promise.allSettled([journal.compareAndSave(first,second),journal.compareAndSave(first,third)]);
  assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
  const current=await journal.load('one');assert.equal(current.revision,2);
  await assert.rejects(()=>journal.compareAndSave(first,{...first,revision:2,stage:'stale'}));
  assert.deepEqual(await journal.load('one'),current);
});
test('update journal is separate from the initial plan and retains one active update',async t=>{
  const directory=await fixture(t),plans=createLocalControlJournal(directory,'plan'),
    updates=createLocalControlJournal(directory,'update');
  const initial={schemaVersion:1,revision:1,transferId:'same-id',owner:'principal-one',stage:'delivered'};
  const prepared={schemaVersion:1,revision:1,updateId:'same-id',owner:'principal-one',stage:'prepared'};
  await plans.create(initial);await updates.createActive(prepared);
  assert.equal(await plans.findActive('principal-one'),null);
  assert.equal(await updates.findActive('principal-one'),'same-id');
  assert.deepEqual(await updates.load('same-id'),prepared);
  await updates.compareAndSave(prepared,{...prepared,revision:2,stage:'delivered'});
  assert.equal(await updates.findActive('principal-one'),null);
  assert.deepEqual(await plans.load('same-id'),initial);
});
test('simultaneous update preparations claim only one active plan for an owner',async t=>{
  const directory=await fixture(t),updates=createLocalControlJournal(directory,'update');
  const first={schemaVersion:1,revision:1,updateId:'update-one',owner:'principal-one',stage:'prepared'};
  const second={...first,updateId:'update-two'};
  const outcomes=await Promise.allSettled([updates.createActive(first),updates.createActive(second)]);
  assert.equal(outcomes.filter(result=>result.status==='fulfilled').length,1);
  assert.equal(outcomes.filter(result=>result.status==='rejected').length,1);
  assert.ok(['update-one','update-two'].includes(await updates.findActive('principal-one')));
  assert.equal(Number((await updates.load('update-one'))!==null)
    +Number((await updates.load('update-two'))!==null),1);
});
