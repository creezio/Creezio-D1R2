import test from 'node:test';
import assert from 'node:assert/strict';
import {manifest,read} from '../helpers.mjs';
import {searchResultFrom} from '../../ui/widgets/search-results.ts';

test('search widget binds the authorized search operation and one direct read action',()=>{
  const widget=manifest.contracts.widgets[0],tool=manifest.contracts.mcp.tools
    .find(item=>item.id==='index.search');
  assert.equal(manifest.validation.suites.widgets.mode,'required');
  assert.equal(widget.id,'search-results');
  assert.deepEqual(tool.widget,{moduleId:'creezio.meili',kind:'widget',id:'search-results'});
  assert.equal(widget.actions[0].target.operation.id,'index.search');
  assert.equal(widget.permissions[0].id,'search');
  assert.equal(widget.resource,'search-results-ui');
  assert.ok(read('ui/widgets/search-results.html').includes('aria-live="polite"'));
  const code=read('ui/widgets/search-results.ts');
  assert.match(code,/textContent=/u);
  assert.doesNotMatch(code,/innerHTML/u);
});
test('widget rejects malformed or oversized hits and unwraps only successful envelopes',()=>{
  const valid={source:'creezio.catalog:catalog-products',items:[{id:'p1',
    fields:{name:'<script>hidden</script>',price_minor:100}}],pageCount:1,stale:false};
  assert.deepEqual(searchResultFrom({kind:'creezio.widget.render.v1',input:valid}),valid);
  assert.equal(searchResultFrom({...valid,pageCount:2}),null);
  assert.equal(searchResultFrom({...valid,items:Array.from({length:21},()=>valid.items[0]),pageCount:21}),null);
  assert.equal(searchResultFrom({kind:'creezio.widget.action.v1',state:'failed',output:valid}),null);
});
