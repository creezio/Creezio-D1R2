import test from 'node:test';
import assert from 'node:assert/strict';
import {manifest,read} from '../helpers.mjs';

test('real list and detail MCP Apps widgets bind to the published product contracts',()=>{
  assert.equal(manifest.validation.suites.widgets.mode,'required');
  assert.deepEqual(manifest.contracts.widgets.map(widget=>widget.id),['product-list','product-detail']);
  for(const [id,operation] of [['product-list','product.search'],['product-detail','product.get']]){
    const widget=manifest.contracts.widgets.find(widget=>widget.id===id);
    const tool=manifest.contracts.mcp.tools.find(tool=>tool.operation.id===operation);
    assert.equal(tool.widget.id,id);
    assert.equal(widget.actions[0].target.operation.id,operation);
    assert.equal(widget.actions[1].target.operation.id,'media.list');
    assert.equal(widget.transport.protocol,'mcp-apps');
    const asset=read(`ui/widgets/${id}.html`);
    assert.match(asset,/<main id="catalog-widget"/u);
    assert.ok(!asset.includes('http://')&&!asset.includes('https://'));
  }
  const media=manifest.contracts.mcp.tools.filter(tool=>tool.operation.id==='media.list');
  assert.equal(media.length,1);
  assert.equal(media[0].widget,undefined,'media.list must not render a product card');
  assert.deepEqual(media[0].widgetCalls.map(ref=>ref.id),['product-list','product-detail']);
});
test('widget renderers use DOM text and direct refresh with unavailable fallback',()=>{
  for(const id of ['product-list','product-detail'])
    assert.match(read(`ui/widgets/${id}.ts`),/mountCatalogWidget/u);
  const runtime=read('ui/widgets/runtime.ts');
  assert.match(runtime,/textContent/u);
  assert.ok(!runtime.includes('innerHTML'));
  assert.match(runtime,/App/u);
  assert.match(runtime,/PostMessageTransport/u);
  assert.match(runtime,/callServerTool/u);
  assert.match(runtime,/indisponible/u);
});
