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
  const catalog=[candidate('card','witness_card_read'),candidate('picker','witness_picker_read'),
    candidate('picker','witness_card_direct')];
  const result=await projectAuthorizedReadTools({catalog,
    widgets:{widgets:[widget('card','witness_card_read'),widget('picker','witness_picker_read')],resources:[]},
    registry:{resolve(){return operation;}},data:{authorize:async()=>({}),dispose(){},requirePermissions(){}},
    request:{credential:{kind:'session',token:'synthetic'},contextId:'application',audience:'admin'}});
  assert.deepEqual(result.tools.map(item=>item.provider.name),['witness_card_read','witness_picker_read']);
  assert.deepEqual(result.tools.map(item=>item.widget.widgetId),['card','picker']);
  assert.ok(result.diagnostics.some(item=>item.endsWith(':widget_unavailable')));
});
