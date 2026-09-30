import test from 'node:test';
import assert from 'node:assert/strict';
import {manifest,read} from '../helpers.mjs';

test('four MCP Apps widgets only display authorized operation output',()=>{
  assert.deepEqual(manifest.contracts.widgets.map(row=>row.id),['notes','summary','transcript','sync']);
  assert.ok(manifest.contracts.widgets.every(row=>row.actions.length===1&&row.actions[0].id==='refresh'));
  for(const widget of manifest.contracts.widgets){
    assert.ok(manifest.contracts.mcp.resources.some(row=>row.widget.id===widget.id));
    assert.match(read(`ui/widgets/${widget.id}.html`),/data-granola-widget/u);
  }
  const source=read('ui/widgets/panels.ts');
  assert.match(source,/textContent/u);
  assert.doesNotMatch(source,/fetch\(|innerHTML|mutate\(/u);
});
