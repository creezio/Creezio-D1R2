import test from 'node:test';
import assert from 'node:assert/strict';
import {manifest} from '../helpers.mjs';

test('three readonly widgets share box ownership and use explicit preview/read operations',()=>{
  assert.deepEqual(manifest.contracts.widgets.map(item=>item.id),['boxes','messages','drafts']);
  assert.equal(manifest.validation.suites.widgets.mode,'required');
  for(const widget of manifest.contracts.widgets){
    assert.deepEqual(widget.audiences,['admin','app']);
  assert.equal(widget.transport.maxPayloadBytes,786432);
    assert.ok(widget.actions.every(action=>action.target.kind==='operation'&&
      manifest.contracts.operations.find(op=>op.id===action.target.operation.id)?.kind==='query'));
    assert.ok(manifest.contracts.mcp.resources.some(resource=>resource.id===widget.resource));
  }
  for(const name of ['box','message','draft']){
    const preview=manifest.contracts.operations.find(op=>op.id===`${name}.preview.list`);
    assert.equal(preview.kind,'query');assert.equal(preview.pagination.maxItems,5);
    assert.deepEqual(preview.effects.writes,[]);
    assert.ok(manifest.contracts.api.some(route=>route.operation.id===preview.id&&route.audience==='app'));
  }
  assert.equal(manifest.contracts.models.some(model=>model.fields.some(field=>field.id==='audience')),false);
  assert.equal(manifest.contracts.operations.find(op=>op.id==='message.send').kind,'command');
});
