import test from 'node:test';
import assert from 'node:assert/strict';
import {manifest} from '../helpers.mjs';

const entities=['company','contact','prospect'];
const operations=new Map(manifest.contracts.operations.map(operation=>[operation.id,operation]));
const tools=new Map(manifest.contracts.mcp.tools.map(tool=>[tool.id,tool]));
const widgets=new Map(manifest.contracts.widgets.map(widget=>[widget.id,widget]));

test('six CRM widgets bind existing read tools and exact operation inputs',()=>{
  assert.equal(widgets.size,6);
  assert.equal(operations.size,21);
  for(const entity of entities){
    for(const kind of ['list','detail']){
      const widget=widgets.get(`${entity}-${kind}`);
      assert.ok(widget);
      assert.deepEqual(widget.audiences,['admin','app']);
      assert.deepEqual(widget.permissions,[{moduleId:'creezio.crm',kind:'permission',id:'use'}]);
      assert.equal(widget.transport.maxPayloadBytes,786432);
      const actions=kind==='list'?['list','search']:['read'];
      assert.deepEqual(widget.actions.map(action=>action.id),actions);
      for(const action of widget.actions){
        const operationId=`${entity}.${action.id}`;
        const operation=operations.get(operationId),tool=tools.get(operationId);
        assert.ok(operation);
        assert.ok(tool);
        assert.deepEqual(action.input,operation.input);
        assert.deepEqual(tool.widget,{moduleId:'creezio.crm',kind:'widget',id:widget.id});
        assert.equal(tool.textFallback,true);
        assert.equal(tool.annotations.readOnly,true);
      }
    }
  }
  assert.ok(manifest.contracts.mcp.tools.filter(tool=>!['read','list','search'].includes(tool.id.split('.')[1]))
    .every(tool=>!tool.widget));
});

function envelope(input,widget){
  return {content:[{type:'text',text:JSON.stringify({executionId:'execution-1',state:'succeeded',output:input,
    errorCode:null,replayed:false})}],structuredContent:{kind:'creezio.widget.render.v1',
    invocationRequestId:'request-1',instance:{host:'external-mcp',instanceId:'instance-1',
      instanceRevision:1,moduleId:'creezio.crm',widgetId:widget.id,widgetVersion:widget.version,
      audience:'app',resourceUri:'ui://crm/company-list',resourceDigest:'sha256-'+ 'a'.repeat(64)},input}};
}

test('complete MCP render envelope accounts for escaped text plus structured page',()=>{
  const declaration=widgets.get('company-list');
  const widget={...declaration,moduleId:'creezio.crm',widgetId:declaration.id,
    resourceUri:'ui://crm/company-list',resourceDigest:'sha256-'+ 'a'.repeat(64)};
  const notes='"\\'.repeat(1500); // Legal 3,000-character notes; both JSON layers escape them.
  const input={items:Array.from({length:25},(_,i)=>({id:`c${i}`,name:`Entreprise ${i}`,
    city:'Paris',website:null,notes,createdAt:'2026-09-29T00:00:00.000Z',
    updatedAt:'2026-09-29T00:00:00.000Z',archivedAt:null,revision:1})),nextCursor:'next-page'};
  const result=envelope(input,widget);
  const bytes=Buffer.byteLength(JSON.stringify(result));
  const inputBytes=Buffer.byteLength(JSON.stringify(input));
  assert.ok(inputBytes>8_192,'a valid CRM page exceeds the internal chat tool-result limit');
  assert.ok(inputBytes>=130000&&inputBytes<=180000,`source page near CRM response budget: ${inputBytes}`);
  assert.ok(bytes>180000,`complete envelope should exceed source page: ${bytes}`);
  assert.ok(bytes<declaration.transport.maxPayloadBytes,`declared MCP transport must fit: ${bytes}`);
  const oversized=envelope({...input,items:[...input.items,...input.items,...input.items,...input.items]},widget);
  assert.ok(Buffer.byteLength(JSON.stringify(oversized))>declaration.transport.maxPayloadBytes);
});
