import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import {sharedWidgetScriptSources} from '../../scripts/build/compose-runtime.mjs';

const digest=text=>`sha256-${createHash('sha256').update(text).digest('hex')}`;
const resource=(moduleId,id,text)=>({moduleId,uri:`ui://example/${id}`,digest:digest(text),text});
const uniqueBody=Array.from({length:15_000},(_,i)=>i.toString(36).padStart(5,'0')).join('');

test('generated resources share one exact central script segment and preserve UTF-8 HTML and digests',()=>{
  // Different adjacent surrogate halves make both segment boundaries cross valid UTF-16 pairs.
  const common=`\uDC00${uniqueBody}\uD800`;
  const resources=[
    resource('alpha','one',`<!doctype html><main>one</main><script>${'a'.repeat(500)}\uD800${common}\uDC00;startOne();</script>`),
    resource('alpha','two',`<!doctype html><main>two</main><script>${'b'.repeat(500)}\uD801${common}\uDC01;startTwo();</script>`),
    resource('beta','single','<!doctype html><script>independent()</script>'),
  ];
  const {sharedParts,resourceSources}=sharedWidgetScriptSources(resources);
  assert.equal(sharedParts.length,1);
  assert.equal(sharedParts[0].length,common.length);
  assert.equal(sharedParts[0][0],'\uDC00');
  assert.equal(sharedParts[0].at(-1),'\uD800');
  assert.equal(resourceSources.filter(source=>source.includes('widgetSharedParts[0]')).length,2);
  const emitted=Buffer.from(`[${resourceSources.join(',')}]`,'utf8').toString('utf8');
  const reconstructed=runInNewContext(emitted,{widgetSharedParts:sharedParts});
  assert.equal(JSON.stringify(reconstructed),JSON.stringify(resources));
  for(const item of reconstructed)assert.equal(digest(item.text),item.digest);
});

test('missing, ambiguous, short and non-plain scripts remain unchanged',()=>{
  assert.deepEqual(sharedWidgetScriptSources([]),{sharedParts:[],resourceSources:[]});
  const one=resource('alpha','one','<!doctype html><script>one()</script>');
  assert.deepEqual(sharedWidgetScriptSources([one]),{sharedParts:[],resourceSources:[JSON.stringify(one)]});
  const cases=[
    [resource('alpha','a',`<script>${'a'.repeat(75_000)};one()</script>`),
      resource('alpha','b',`<script>${'a'.repeat(75_000)};two()</script>`) ],
    [resource('alpha','a',`<script>${'a'.repeat(75_000)}</script>`),
      resource('alpha','b',`<script>${'b'.repeat(75_000)}</script>`) ],
    [resource('alpha','a',`<script>one${uniqueBody.slice(0,20_000)}endA</script>`),
      resource('alpha','b',`<script>two${uniqueBody.slice(0,20_000)}endB</script>`) ],
    [resource('alpha','a',`<script type="module">${uniqueBody}</script>`),
      resource('alpha','b',`<script type="module">${uniqueBody}</script>`) ],
    [resource('alpha','a',`<script>${uniqueBody}</script><script>one()</script>`),
      resource('alpha','b',`<script>${uniqueBody}</script><script>two()</script>`) ],
  ];
  for(const resources of cases){
    const result=sharedWidgetScriptSources(resources);
    assert.deepEqual(result,{sharedParts:[],resourceSources:resources.map(JSON.stringify)});
  }
});
