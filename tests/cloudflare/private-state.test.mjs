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
