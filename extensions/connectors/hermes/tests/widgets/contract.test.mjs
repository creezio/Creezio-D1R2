import test from 'node:test';
import assert from 'node:assert/strict';
import {manifest,read} from '../helpers.mjs';
import {hermesDirectOutput,hermesRead,hermesRender} from '../../ui/widgets/model.ts';

test('three Hermes MCP Apps widgets bind only existing authorized read operations',()=>{
  assert.deepEqual(manifest.contracts.widgets.map(row=>row.id),['capabilities','models','run']);
  assert.equal(manifest.validation.suites.widgets.mode,'required');
  assert.equal(manifest.lifecycle.absent.widgets,undefined);
  const operations=['capabilities.read','models.list','run.read'];
  for(const [index,widget] of manifest.contracts.widgets.entries()){
    assert.equal(widget.actions.length,1);
    assert.equal(widget.actions[0].mode,'direct');
    assert.equal(widget.actions[0].target.operation.id,operations[index]);
    assert.equal(manifest.contracts.operations.find(op=>op.id===operations[index]).kind,'query');
    assert.ok(manifest.contracts.mcp.tools.some(tool=>tool.operation.id===operations[index]
      &&tool.widget?.id===widget.id));
    assert.ok(manifest.contracts.mcp.resources.some(row=>row.widget?.id===widget.id
      &&row.source.path===`ui/widgets/${widget.id}.html`));
    assert.match(read(`ui/widgets/${widget.id}.html`),/data-hermes-widget/u);
  }
  assert.deepEqual(manifest.contracts.widgets.map(row=>row.audiences),[['admin'],['admin'],['admin','app']]);
  const runtime=read('ui/widgets/runtime.ts');
  assert.match(runtime,/callServerTool\(call\)/u);
  assert.match(runtime,/addEventListener\('click'/u);
  assert.doesNotMatch(runtime,/fetch\(|innerHTML|hermes_run_submit|hermes_run_stop/u);
});

const resourceDigest=`sha256-${'a'.repeat(64)}`;
const internal=(widgetId='run',audience='app')=>({kind:'creezio.widget.render.v1',
  instance:{host:'creezio',moduleId:'creezio.hermes',widgetId,widgetVersion:'1.0.0',
    instanceRevision:1,instanceId:'instance-1',audience,
    conversationId:'conversation-1',messageId:'message-1'},
  input:{run:{id:'run-local-1',remote:null,status:'prepared',revision:1}}});
const external=(widgetId='run',audience='app',instanceId='external-1')=>({
  kind:'creezio.widget.render.v1',invocationRequestId:'invocation-1',
  instance:{host:'external-mcp',moduleId:'creezio.hermes',widgetId,widgetVersion:'1.0.0',
    instanceRevision:1,instanceId,audience,resourceDigest,
    resourceUri:`ui://creezio/creezio.hermes/${widgetId}/1.0.0/${resourceDigest}.html`},
  input:{run:{id:'run-local-1',remote:null,status:'prepared',revision:1}}});

test('internal host render needs its exact input instance; external host render needs a bound resource',()=>{
  const hostInput={instanceId:'instance-1',audience:'app'};
  assert.equal(hermesRender('run',internal(),hostInput)?.host,'creezio');
  assert.equal(hermesRender('run',{...internal(),instance:{...internal().instance,
    instanceRevision:2}},hostInput)?.host,'creezio');
  assert.equal(hermesRender('run',internal()),null);
  assert.equal(hermesRender('run',internal(),{...hostInput,instanceId:'other'}),null);
  assert.equal(hermesRender('run',internal(),{...hostInput,audience:'admin'}),null);
  assert.equal(hermesRender('models',internal('models','app'),hostInput),null);
  assert.equal(hermesRender('run',internal('models'),hostInput),null);
  assert.equal(hermesRender('run',{...internal(),instance:{...internal().instance,
    moduleId:'creezio.other'}},hostInput),null);
  assert.equal(hermesRender('run',{...internal(),instance:{...internal().instance,
    messageId:''}},hostInput),null);
  assert.equal(hermesRender('run',external())?.host,'external-mcp');
  assert.equal(hermesRender('run',{...external(),instance:{...external().instance,
    instanceRevision:2}}),null);
  assert.equal(hermesRender('run',{...external(),instance:{...external().instance,
    resourceUri:'ui://creezio/other/run/1.0.0/'+resourceDigest+'.html'}}),null);
  assert.equal(hermesRender('run',{...external(),invocationRequestId:''}),null);
  assert.deepEqual(hermesRead('run','run-local-1'),
    {name:'hermes_run_read',arguments:{id:'run-local-1'}});
  assert.equal(hermesRead('run','remote/id'),null);
  assert.deepEqual(hermesRead('capabilities',''),{name:'hermes_capabilities_read',arguments:{}});
  assert.deepEqual(hermesRead('models',''),{name:'hermes_models_list',arguments:{}});
});

test('direct reads accept each real host envelope only for the same widget, audience and local run',()=>{
  const output={run:{id:'run-local-1',remote:null,status:'prepared',revision:1}};
  const internalIdentity=hermesRender('run',internal(),{instanceId:'instance-1',audience:'app'});
  const externalIdentity=hermesRender('run',external());
  assert.deepEqual(hermesDirectOutput('run',{structuredContent:{kind:'creezio.widget.action.v1',
    state:'succeeded',output}},internalIdentity,'run-local-1'),output);
  const later=external('run','app','external-2');
  assert.deepEqual(hermesDirectOutput('run',{structuredContent:later},externalIdentity,'run-local-1'),
    output);
  assert.equal(hermesDirectOutput('run',{structuredContent:later},internalIdentity,'run-local-1'),null);
  assert.equal(hermesDirectOutput('run',{structuredContent:{kind:'creezio.widget.action.v1',
    state:'succeeded',output}},externalIdentity,'run-local-1'),null);
  assert.equal(hermesDirectOutput('run',{structuredContent:{...later,instance:{...later.instance,
    audience:'admin'}}},externalIdentity,'run-local-1'),null);
  assert.equal(hermesDirectOutput('run',{structuredContent:{...later,instance:{...later.instance,
    widgetId:'models'}}},externalIdentity,'run-local-1'),null);
  assert.equal(hermesDirectOutput('run',{structuredContent:{...later,input:{run:{...output.run,
    id:'another-run'}}}},externalIdentity,'run-local-1'),null);
  assert.equal(hermesDirectOutput('run',{structuredContent:{kind:'creezio.widget.render.v1',
    input:output}},externalIdentity,'run-local-1'),null);
  for(const state of ['unknown','transmitted','rejected'])
    assert.equal(hermesDirectOutput('run',{structuredContent:{kind:'creezio.widget.action.v1',
      state,output}},internalIdentity,'run-local-1'),null);
  assert.equal(hermesDirectOutput('run',{isError:true,structuredContent:later},
    externalIdentity,'run-local-1'),null);
});
