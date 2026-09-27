import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compileMcpBindings} from '../../../../scripts/mcp/bindings.mjs';
import {contractIntegrity} from '../../../../sdk/contracts/validate.mjs';

const json=path=>JSON.parse(readFileSync(new URL(path,import.meta.url)));
test('MCP bindings retain native query/command effects and widget resource links',()=>{
  const module=json('../../module/manifest.json'), moduleId=module.identity.id;
  const composition={modules:[{moduleId,enabled:true}],exposure:{admin:{moduleIds:[moduleId]},app:{moduleIds:[moduleId]}}};
  const operationCatalog={schemaVersion:1,modules:[{moduleId,operations:module.contracts.operations.map(operation=>({
    operation,active:true,contractDigest:contractIntegrity({operation})}))}]};
  const output=module.contracts.schemas.find(item=>item.id==='record-output').schema;
  const widgetCatalog={widgets:module.contracts.widgets.map(widget=>({moduleId,widgetId:widget.id,version:widget.version,
    resourceUri:`ui://creezio/${moduleId}/${widget.id}/${widget.version}/sha256-${'a'.repeat(64)}.html`,
    resourceDigest:`sha256-${'a'.repeat(64)}`,schemas:{input:{digest:contractIntegrity(output)}},
    audiences:widget.audiences,permissions:[`${moduleId}:read`]})),resources:[]};
  widgetCatalog.resources=widgetCatalog.widgets.map(widget=>({uri:widget.resourceUri,digest:widget.resourceDigest,
    cspProfileId:`sha256-${'b'.repeat(64)}`,text:'<!doctype html><html></html>',uiMeta:{csp:{},permissions:{}}}));
  const bindings=compileMcpBindings({composition,modules:[module],operationCatalog,widgetCatalog});
  assert.equal(bindings.tools.length,6);
  assert.equal(bindings.resources.length,4);
  assert.ok(bindings.tools.every(tool=>tool.auth.includes('oauth')&&tool.ui?.visibility.includes('app')));
  assert.ok(bindings.resources.every(resource=>resource.source.kind==='compiled-widget'));
  assert.ok(bindings.tools.filter(tool=>tool.operationId==='rename_record').every(tool=>!tool.annotations.readOnly));
});
