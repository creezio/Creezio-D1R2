import test from 'node:test';
import assert from 'node:assert/strict';
import {projectAuthorizedReadTools} from '../../core/providers/tools.ts';

const digest=`sha256-${'a'.repeat(64)}`;
const schema={type:'object',properties:{id:{type:'string'}},required:['id'],additionalProperties:false};
const operation={contractDigest:digest,declaration:{id:'read_record',title:'Lire une fiche',kind:'query',
  approval:{mode:'none'},effects:{reads:[],writes:[],emits:[],calls:[],providers:[]},
  audiences:['admin'],actors:['user'],permissions:[]}};
const widget=(widgetId,toolName)=>({moduleId:'example.widgets-witness',widgetId,version:'1.0.0',
  resourceDigest:digest,audiences:['admin'],permissions:[],
  renderTools:[{toolName,operationModuleId:'example.widgets-witness',operationId:'read_record',
    operationDigest:digest,audiences:['admin']}],
  // A direct-action tool can have another name; it must not determine a render alias.
  serverTools:[{toolName:'witness_card_direct',operationDigest:digest}]});
const candidate=(widgetId,toolName)=>({moduleId:'example.widgets-witness',operationId:'read_record',
  inputSchema:schema,schemaDigest:digest,audiences:['admin'],
  widget:{moduleId:'example.widgets-witness',widgetId,version:'1.0.0',resourceDigest:digest,
    toolName,operationDigest:digest}});

test('provider exposes distinct render aliases for one read operation and ignores direct-action names',async()=>{
  const canonical={moduleId:'example.widgets-witness',operationId:'read_record',
    inputSchema:schema,schemaDigest:digest,audiences:['admin']};
  const catalog=[canonical,candidate('card','witness_card_read'),candidate('picker','witness_picker_read'),
    candidate('picker','witness_card_direct')];
  const options={catalog,
    widgets:{widgets:[widget('card','witness_card_read'),widget('picker','witness_picker_read')],resources:[]},
    registry:{resolve(){return operation;}},data:{authorize:async()=>({}),dispose(){},requirePermissions(){}},
    request:{credential:{kind:'session',token:'synthetic'},contextId:'application',audience:'admin'}};
  const result=await projectAuthorizedReadTools(options);
  assert.deepEqual(result.tools.map(item=>item.provider.name),['witness_card_read','witness_picker_read']);
  assert.deepEqual(result.tools.map(item=>item.widget.widgetId),['card','picker']);
  assert.ok(result.diagnostics.some(item=>item.endsWith(':widget_unavailable')));
  const noWidget=await projectAuthorizedReadTools({...options,widgets:{widgets:[],resources:[]}});
  assert.equal(noWidget.tools.length,1);
  assert.equal(noWidget.tools[0].widget,undefined);
  assert.equal(noWidget.tools[0].operationId,'read_record');
  const forbiddenWidget=await projectAuthorizedReadTools({...options,catalog:[canonical,
    candidate('card','witness_card_read')],
    widgets:{widgets:[{...widget('card','witness_card_read'),permissions:['blocked']}],resources:[]},
    data:{...options.data,requirePermissions(){throw new Error('forbidden');}}});
  assert.equal(forbiddenWidget.tools.length,1);
  assert.equal(forbiddenWidget.tools[0].widget,undefined);
  assert.ok(forbiddenWidget.diagnostics.includes('example.widgets-witness:read_record:widget_forbidden'));
  const wrongContract=await projectAuthorizedReadTools({...options,catalog:[canonical,
    {...candidate('card','witness_card_read'),widget:{...candidate('card','witness_card_read').widget,
      operationDigest:`sha256-${'b'.repeat(64)}`}}]});
  assert.equal(wrongContract.tools.length,1);
  assert.equal(wrongContract.tools[0].widget,undefined);
  assert.ok(wrongContract.diagnostics.includes('example.widgets-witness:read_record:widget_unavailable'));
  const wrongAudience=await projectAuthorizedReadTools({...options,catalog:[canonical,
    candidate('card','witness_card_read')],
    widgets:{widgets:[{...widget('card','witness_card_read'),audiences:['app']}],resources:[]}});
  assert.equal(wrongAudience.tools.length,1);
  assert.equal(wrongAudience.tools[0].widget,undefined);
  const differentSchema=await projectAuthorizedReadTools({...options,catalog:[
    {...canonical,schemaDigest:`sha256-${'b'.repeat(64)}`},candidate('card','witness_card_read')]});
  assert.deepEqual(differentSchema.tools.map(item=>!!item.widget),[true,false]);
});

test('render alias takes a bounded slot only when admitted, leaving a canonical fallback',async()=>{
  const canonical={moduleId:'example.widgets-witness',operationId:'read_record',
    inputSchema:schema,schemaDigest:digest,audiences:['admin']};
  const others=Array.from({length:127},(_,index)=>({...canonical,operationId:`read_other_${index}`}));
  const options={catalog:[canonical,...others,candidate('card','witness_card_read')],
    registry:{resolve(_moduleId,id){return {...operation,declaration:{...operation.declaration,id}};}},
    data:{authorize:async()=>({}),dispose(){},requirePermissions(){}},
    request:{credential:{kind:'session',token:'synthetic'},contextId:'application',audience:'admin'}};
  const admitted=await projectAuthorizedReadTools({...options,
    widgets:{widgets:[widget('card','witness_card_read')],resources:[]}});
  assert.equal(admitted.tools.length,128);
  assert.equal(admitted.tools[0].provider.name,'witness_card_read');
  assert.equal(admitted.tools.some(item=>item.operationId==='read_record'&&!item.widget),false);
  const fallback=await projectAuthorizedReadTools({...options,widgets:{widgets:[],resources:[]}});
  assert.equal(fallback.tools.length,128);
  assert.equal(fallback.tools[0].operationId,'read_record');
  assert.equal(fallback.tools[0].widget,undefined);
  assert.equal(fallback.tools.at(-1).operationId,'read_other_126');
});
