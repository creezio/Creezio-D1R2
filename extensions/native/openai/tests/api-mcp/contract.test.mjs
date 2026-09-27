import test from 'node:test';
import assert from 'node:assert/strict';
import {manifest} from '../helpers.mjs';

test('admin key write is a declared session-only command with redacted input and protected effects',()=>{
  const command=manifest.contracts.operations.find(op=>op.id==='config.key.set');
  assert.deepEqual(command.permissions,[{moduleId:'creezio.openai',kind:'permission',id:'manage'}]);
  assert.ok(command.effects.writes.some(ref=>ref.id==='provider_secret'));
  assert.ok(command.audit.redactFields.includes('apiKey'));
  const binding=manifest.contracts.api.find(item=>item.id==='admin.config.key.set');
  assert.deepEqual(binding.auth,['session']);
  assert.equal(binding.method,'POST');
  assert.equal(manifest.contracts.api.some(item=>item.id==='app.config.key.set'),false);
});

test('model and configuration reads are declared for both chat audiences',()=>{
  for(const audience of ['admin','app'])for(const operation of ['config.read','models.list'])
    assert.ok(manifest.contracts.api.some(binding=>binding.id===`${audience}.${operation}`));
});
