import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {buildSync} from 'esbuild';
import {manifest} from '../helpers.mjs';
import {compileWidgetCatalog} from '../../../../../scripts/widgets/compile.mjs';
import {compileMcpBindings} from '../../../../../scripts/mcp/bindings.mjs';
import {contractIntegrity} from '../../../../../sdk/contracts/validate.mjs';
import {moduleDetailFromTool} from '../../ui/widgets/module-detail.ts';

test('admin module detail widget reuses the readonly catalog.detail operation',()=>{
  const moduleId=manifest.identity.id;
  const composition={modules:[{moduleId,enabled:true}],exposure:{admin:{moduleIds:[moduleId]},app:{moduleIds:[]}}};
  const operationCatalog={schemaVersion:1,modules:[{moduleId,operations:manifest.contracts.operations.map(operation=>({
    operation,active:true,contractDigest:contractIntegrity({operation})}))}]};
  const root=new URL('../../',import.meta.url);
  const widgetCatalog=compileWidgetCatalog({composition,modules:[manifest],operationCatalog,
    readAsset:(_id,relative)=>readFileSync(new URL(relative,root),'utf8'),
    bundleRenderer:(_id,reference)=>buildSync({entryPoints:[fileURLToPath(new URL(reference.path,root))],
      bundle:true,write:false,platform:'browser',format:'iife',globalName:'__creezioWidget',
      target:'es2022',minify:true,logLevel:'silent',
      footer:{js:`__creezioWidget.${reference.export}();`}}).outputFiles[0].text});
  assert.equal(widgetCatalog.widgets.length,1);
  assert.equal(widgetCatalog.widgets[0].widgetId,'module-detail');
  assert.deepEqual(widgetCatalog.widgets[0].actions.map(action=>action.mode),['direct']);
  assert.deepEqual(widgetCatalog.widgets[0].audiences,['admin']);
  const bindings=compileMcpBindings({composition,modules:[manifest],operationCatalog,widgetCatalog});
  const tool=bindings.tools.find(binding=>binding.name==='modules_catalog_detail');
  assert.equal(tool?.annotations.readOnly,true);
  assert.equal(tool?.ui?.resourceUri,widgetCatalog.resources[0].uri);
  assert.equal(bindings.resources.filter(resource=>resource.source.kind==='compiled-widget').length,1);
  assert.ok(bindings.tools.every(binding=>binding.auth.includes('oauth')));
});

test('module detail refresh accepts native action output and MCP render input',()=>{
  const detail={module:{moduleId:'creezio.modules-settings',title:'Modules',version:'1.0.0',enabled:true}};
  assert.deepEqual(moduleDetailFromTool({kind:'creezio.widget.render.v1',input:detail}),detail);
  assert.deepEqual(moduleDetailFromTool({kind:'creezio.widget.action.v1',
    state:'succeeded',code:'succeeded',output:detail}),detail);
  assert.equal(moduleDetailFromTool({kind:'creezio.widget.action.v1',
    state:'transmitted',output:detail}),null);
});
