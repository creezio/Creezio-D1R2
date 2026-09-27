import test from 'node:test';
import assert from 'node:assert/strict';
import {manifest, read} from '../helpers.mjs';
import {hostOnly} from '../../module/operations.ts';
import {validNativeAccessDeclaration} from '../../../../../core/operations/native-access.ts';

const ids = ['policy.read','permissions.list','principals.list','sessions.list','audit.list','audit.detail',
  'policy.apply-delta','principals.set-human-status','principals.revoke-sessions','sessions.revoke'];
const refs = manifest.contracts.operations;

test('native Access exposes the same ten reviewed operation IDs through API and MCP declarations', () => {
  assert.deepEqual(refs.map(item=>item.id),ids);
  assert.deepEqual(manifest.contracts.api.map(item=>item.operation.id),ids);
  assert.deepEqual(manifest.contracts.mcp.tools.map(item=>item.operation.id),ids);
  for (const operation of refs) {
    assert.equal(validNativeAccessDeclaration(operation),true,operation.id);
    assert.deepEqual(operation.permissions,[{moduleId:'creezio.access',kind:'permission',id:'manage'}]);
    assert.deepEqual(operation.audiences,['admin']);
    assert.deepEqual(operation.actors,['user','delegated-user']);
    assert.equal(operation.context,'application');
    assert.equal(operation.public,false);
  }
  for (const binding of manifest.contracts.api) {
    assert.match(binding.path,/^\/api\/admin\/access\//);
    assert.deepEqual(binding.auth,['session','oauth']);
    assert.equal(binding.audience,'admin');
    assert.equal(binding.input.schemaId,refs.find(item=>item.id===binding.operation.id).input.schemaId);
  }
  assert.deepEqual(JSON.parse(read('plugin/mcp.json')),{mcpServers:{}});
  for (const tool of manifest.contracts.mcp.tools) assert.deepEqual(tool.auth,['oauth']);
  assert.deepEqual(manifest.contracts.publicContracts,[]);
});

test('native commands carry explicit idempotency and the expected T04 version guard', () => {
  const expected = {'policy.apply-delta':'expectedEpoch','principals.set-human-status':'expectedAuthVersion',
    'principals.revoke-sessions':'expectedAuthVersion','sessions.revoke':null};
  for (const [id, field] of Object.entries(expected)) {
    const operation = refs.find(item=>item.id===id);
    assert.equal(operation.kind,'command');
    assert.equal(operation.idempotency.mode,'required');
    assert.equal(operation.idempotency.keyField,'requestKey');
    assert.deepEqual(operation.concurrency,field?{mode:'object-version',versionField:field}:{mode:'none'});
    assert.ok(operation.effects.writes.length>0);
  }
  for (const query of refs.filter(item=>item.kind==='query')) {
    assert.deepEqual(query.effects.writes,[]);
    assert.equal(query.idempotency.mode,'none');
  }
  assert.throws(()=>hostOnly(),/host executor/);
  assert.equal(manifest.contracts.api.some(item=>/bootstrap|install|invite|password/.test(item.path)),false);
});
