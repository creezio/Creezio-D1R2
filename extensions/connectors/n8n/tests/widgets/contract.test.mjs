import test from 'node:test';
import assert from 'node:assert/strict';
import {manifest,read} from '../helpers.mjs';
import {n8nDirectOutput,n8nRead,n8nRender} from '../../ui/widgets/model.ts';

test('read-only MCP Apps widgets show authorized workflow and run metadata',()=>{
  assert.deepEqual(manifest.contracts.widgets.map(row=>row.id),['workflows','run']);
  assert.equal(manifest.validation.suites.widgets.mode,'required');
  for(const widget of manifest.contracts.widgets){
    assert.equal(widget.actions.length,1);
    assert.equal(widget.actions[0].id,'refresh');
    assert.ok(manifest.contracts.mcp.resources.some(row=>row.widget.id===widget.id));
    assert.match(read(`ui/widgets/${widget.id}.html`),/data-n8n-widget/u);
  }
  const source=read('ui/widgets/panels.ts');
  assert.match(source,/textContent/u);
  assert.doesNotMatch(source,/fetch\(|innerHTML|mutate\(/u);
});
const resourceDigest=`sha256-${'a'.repeat(64)}`;
const output={run:{id:'run-1',status:'accepted',revision:2}};
const internal=()=>({kind:'creezio.widget.render.v1',instance:{host:'creezio',
  moduleId:'creezio.n8n',widgetId:'run',widgetVersion:'1.0.0',instanceRevision:1,
  instanceId:'internal-1',audience:'app',conversationId:'conversation-1',messageId:'message-1'},input:output});
const external=(instanceId='external-1')=>({kind:'creezio.widget.render.v1',
  invocationRequestId:'invocation-1',instance:{host:'external-mcp',moduleId:'creezio.n8n',
    widgetId:'run',widgetVersion:'1.0.0',instanceRevision:1,instanceId,audience:'app',
    resourceDigest,resourceUri:`ui://creezio/creezio.n8n/run/1.0.0/${resourceDigest}.html`},input:output});

test('internal Creezio render binds the host tool input; external MCP render binds its resource',()=>{
  const hostInput={instanceId:'internal-1',audience:'app'};
  assert.equal(n8nRender('run',internal(),hostInput)?.host,'creezio');
  assert.equal(n8nRender('run',internal()),null);
  assert.equal(n8nRender('run',internal(),{...hostInput,instanceId:'other'}),null);
  assert.equal(n8nRender('run',internal(),{...hostInput,audience:'admin'}),null);
  assert.equal(n8nRender('run',{...internal(),instance:{...internal().instance,messageId:''}},hostInput),null);
  assert.equal(n8nRender('run',external())?.host,'external-mcp');
  assert.equal(n8nRender('run',{...external(),instance:{...external().instance,widgetId:'workflows'}}),null);
  assert.equal(n8nRender('run',{...external(),instance:{...external().instance,
    resourceDigest:`sha256-${'b'.repeat(64)}`}}),null);
  assert.deepEqual(n8nRead('run','run-1'),{name:'n8n_run_read',arguments:{id:'run-1'}});
  assert.equal(n8nRead('run','remote/id'),null);
  assert.deepEqual(n8nRead('workflows',''),{name:'n8n_workflow_list',arguments:{limit:25}});
  assert.match(read('ui/widgets/panels.ts'),/addEventListener\('toolinput'/u);
});

test('direct reread accepts native action without instance and external render with new instance ID',()=>{
  const native=n8nRender('run',internal(),{instanceId:'internal-1',audience:'app'});
  const mcp=n8nRender('run',external());
  assert.deepEqual(n8nDirectOutput('run',{structuredContent:{kind:'creezio.widget.action.v1',
    state:'succeeded',output}},native,'run-1'),output);
  assert.deepEqual(n8nDirectOutput('run',{structuredContent:external('external-2')},mcp,'run-1'),output);
  assert.equal(n8nDirectOutput('run',{structuredContent:external()},native,'run-1'),null);
  assert.equal(n8nDirectOutput('run',{structuredContent:{kind:'creezio.widget.action.v1',
    state:'succeeded',output}},mcp,'run-1'),null);
  assert.equal(n8nDirectOutput('run',{structuredContent:{...external(),instance:{...external().instance,
    audience:'admin'}}},mcp,'run-1'),null);
  assert.equal(n8nDirectOutput('run',{structuredContent:{...external(),input:{run:{...output.run,
    id:'other'}}}},mcp,'run-1'),null);
  for(const state of ['unknown','transmitted','rejected'])
    assert.equal(n8nDirectOutput('run',{structuredContent:{kind:'creezio.widget.action.v1',
      state,output}},native,'run-1'),null);
});
