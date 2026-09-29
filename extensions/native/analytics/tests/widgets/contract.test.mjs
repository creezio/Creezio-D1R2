import test from 'node:test';
import assert from 'node:assert/strict';
import {manifest} from '../helpers.mjs';

test('two admin-only query widgets use read permission and bounded projections',()=>{
  assert.deepEqual(manifest.contracts.widgets.map(widget=>widget.id),['summary','events']);
  assert.equal(manifest.validation.suites.widgets.mode,'required');
  for(const widget of manifest.contracts.widgets){
    assert.deepEqual(widget.audiences,['admin']);
    assert.equal(widget.transport.maxPayloadBytes,65536);
    const target=widget.actions[0].target.operation.id;
    const operation=manifest.contracts.operations.find(item=>item.id===target);
    assert.equal(operation.kind,'query');assert.deepEqual(operation.effects.writes,[]);
    assert.equal(operation.permissions[0].id,'read');
    assert.ok(manifest.contracts.mcp.resources.some(resource=>resource.id===widget.resource));
  }
  assert.equal(manifest.contracts.schemas.find(schema=>schema.id==='analytics-widget-events-output')
    .schema.properties.items.maxItems,5);
  assert.equal(manifest.contracts.schemas.find(schema=>schema.id==='analytics-widget-summary-output')
    .schema.properties.timeline.maxItems,8);
  assert.equal(manifest.contracts.widgets.some(widget=>widget.audiences.includes('app')),false);
});
