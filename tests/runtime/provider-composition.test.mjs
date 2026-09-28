import test from 'node:test';
import assert from 'node:assert/strict';
import {copyFileSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {composeRuntime} from '../../scripts/build/compose-runtime.mjs';
import {providerOutputDescription} from '../../scripts/build/provider-output-description.mjs';
import {contractIntegrity} from '../../sdk/contracts/validate.mjs';
import {temporaryDirectory} from '../quality/temporary.mjs';

const repository=fileURLToPath(new URL('../../',import.meta.url));
const read=relative=>JSON.parse(readFileSync(path.join(repository,relative),'utf8'));
const generated=readFileSync(path.join(repository,'.creezio/generated/provider-catalog.ts'),'utf8');
const catalog=JSON.parse(generated.match(/export const toolCatalog: readonly ProviderOperationSchema\[\] = freeze\((\[[^\n]+\])\);/)?.[1]??'null');
const widgetsSource=readFileSync(path.join(repository,'.creezio/generated/widget-catalog.ts'),'utf8');
const widgets=JSON.parse(widgetsSource.match(/export const widgetCatalog: CompiledWidgetCatalog = freeze\((\{[^\n]+\})\);/)?.[1]??'null');

test('output descriptions preserve declared field meaning in read and list schemas without copying schema data',()=>{
  const request={type:'object',properties:{amountMinor:{type:'integer',minimum:0,
    description:'Amount in the minor unit of currency, not a major-unit amount.'},
    currency:{type:'string',description:'Three-letter currency code.'}}};
  const read={type:'object',properties:{request:{anyOf:[request,{type:'null'}]}}};
  const list={type:'object',properties:{items:{type:'array',items:request,maxItems:50}}};
  assert.equal(providerOutputDescription(read),
    'request.amountMinor: Amount in the minor unit of currency, not a major-unit amount.; request.currency: Three-letter currency code.');
  assert.equal(providerOutputDescription(list),
    'items[].amountMinor: Amount in the minor unit of currency, not a major-unit amount.; items[].currency: Three-letter currency code.');
  const oversized={type:'object',properties:{secret:{type:'string',description:'x'.repeat(2000)},
    valid:{type:'string',description:'Declared meaning.'}}};
  assert.equal(providerOutputDescription(oversized),'valid: Declared meaning.');
  assert.equal(providerOutputDescription({type:'object',properties:{amountMinor:{type:'integer'}}}),'');
});

test('provider tool schemas are the exact canonical inputs of selected operations',()=>{
  assert.ok(Array.isArray(catalog)&&catalog.length>0);
  assert.ok(widgets&&Array.isArray(widgets.widgets));
  const composition=read('configuration/composition.json');
  const selected=new Set(composition.modules.filter(item=>item.enabled).map(item=>item.moduleId));
  const seen=new Set(),widgetAliases=[];
  for(const item of catalog){
    assert.deepEqual(Object.keys(item).sort(),['audiences','inputSchema','moduleId','operationId','schemaDigest',
      ...(item.widget?['widget']:[])]);
    assert.ok(selected.has(item.moduleId));
    const label=`${item.moduleId}:${item.operationId}`;
    const identity=item.widget?`${label}:${item.widget.toolName}`:label;
    assert.equal(seen.has(identity),false);seen.add(identity);
    const module=composition.modules.find(node=>node.moduleId===item.moduleId);
    assert.deepEqual(item.audiences,['admin','app'].filter(audience=>
      composition.exposure[audience].moduleIds.includes(item.moduleId)));
    const manifest=read(`${module.source.path}/module/manifest.json`);
    const operation=manifest.contracts.operations.find(op=>op.id===item.operationId);
    assert.ok(operation,label);
    const schema=manifest.contracts.schemas.find(entry=>entry.id===operation.input.schemaId)?.schema;
    assert.deepEqual(item.inputSchema,schema,label);
    assert.equal(item.schemaDigest,contractIntegrity(schema),label);
    if(item.widget){
      widgetAliases.push(`${label}:${item.widget.toolName}`);
      assert.deepEqual(Object.keys(item.widget).sort(),
        ['moduleId','operationDigest','resourceDigest','toolName','version','widgetId']);
      const widget=widgets.widgets.find(candidate=>candidate.moduleId===item.widget.moduleId
        &&candidate.widgetId===item.widget.widgetId&&candidate.version===item.widget.version);
      assert.ok(widget,`${label}:widget`);
      assert.equal(item.widget.resourceDigest,widget.resourceDigest,label);
      assert.ok(widget.renderTools.some(tool=>tool.toolName===item.widget.toolName
        &&tool.operationModuleId===item.moduleId&&tool.operationId===item.operationId
        &&tool.operationDigest===item.widget.operationDigest
        &&item.audiences.every(audience=>tool.audiences.includes(audience))),label);
      const owner=composition.modules.find(node=>node.moduleId===item.widget.moduleId);
      const widgetManifest=read(`${owner.source.path}/module/manifest.json`);
      assert.ok(widgetManifest.contracts.widgets.some(entry=>entry.id===item.widget.widgetId
        &&entry.version===item.widget.version),label);
      assert.ok(widgetManifest.contracts.mcp.tools.some(tool=>tool.name===item.widget.toolName
        &&tool.operation.id===item.operationId&&tool.widget.id===item.widget.widgetId
        &&tool.annotations.readOnly===true),label);
    }
  }
  const declaredWidgetAliases=composition.modules.filter(node=>node.enabled).flatMap(node=>{
    const manifest=read(`${node.source.path}/module/manifest.json`);
    return manifest.contracts.mcp.tools.filter(tool=>tool.widget&&tool.annotations.readOnly
      &&tool.audiences.some(audience=>composition.exposure[audience].moduleIds.includes(node.moduleId)))
      .map(tool=>`${node.moduleId}:${tool.operation.id}:${tool.name}`);
  });
  assert.deepEqual(widgetAliases.sort(),declaredWidgetAliases.sort());
  assert.match(generated,/export const openAiProvider = Object\.freeze\(\{config:/);
  assert.doesNotMatch(generated,/CREEZIO_VAULT_KEYRING|Bearer\s|sk-proj-/);
});

test('composition without OpenAI emits no provider import or host definition',async t=>{
  const root=temporaryDirectory(t,'creezio-provider-compose-');
  mkdirSync(path.join(root,'configuration'));
  writeFileSync(path.join(root,'package.json'),'{"type":"module"}\n');
  const composition=read('configuration/composition.json');
  const lock=read('configuration/composition.lock.json');
  composition.modules=composition.modules.filter(item=>item.moduleId==='creezio.access');
  lock.modules=lock.modules.filter(item=>item.moduleId==='creezio.access');
  for(const exposure of Object.values(composition.exposure))
    exposure.moduleIds=exposure.moduleIds.filter(id=>id==='creezio.access');
  lock.compositionIntegrity=contractIntegrity(composition);
  const access=read('extensions/native/access/module/manifest.json');
  for(const file of access.packaging.runtime.files){
    const relative=path.join('extensions/native/access',file),destination=path.join(root,relative);
    mkdirSync(path.dirname(destination),{recursive:true});
    copyFileSync(path.join(repository,relative),destination);
  }
  writeFileSync(path.join(root,'configuration/composition.json'),JSON.stringify(composition));
  writeFileSync(path.join(root,'configuration/composition.lock.json'),JSON.stringify(lock));
  await composeRuntime({root});
  const source=readFileSync(path.join(root,'.creezio/generated/provider-catalog.ts'),'utf8');
  assert.match(source,/export const openAiProvider = null;/);
  assert.doesNotMatch(source,/extensions\/native\/openai|openAiConfigStorage|createOpenAITransport/);
  assert.doesNotMatch(source,/"moduleId":"creezio\.openai"/);
});
