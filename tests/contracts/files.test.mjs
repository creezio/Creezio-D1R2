import test from 'node:test';
import {readFileSync} from 'node:fs';
import { validateModule } from '../../sdk/contracts/validate.mjs';
import { fixture, accepted, refused } from './helpers.mjs';

test('file storage mapping is explicit and its metadata remains private and scoped', () => {
  const positive = fixture();
  accepted(validateModule(positive));
  for (const ownerScope of ['principal', 'principal-audience']) {
    const withScope = structuredClone(positive);
    withScope.contracts.files[0].ownerScope = ownerScope;
    accepted(validateModule(withScope));
  }
  const cases = [
    ['unknown owner scope', file => { file.ownerScope = 'session'; }, 'schema.invalid'],
    ['missing mapping', (file) => { delete file.storageFields; }, 'schema.invalid'],
    ['aliased storage fields', file => { file.storageFields.digest = file.storageFields.objectKey; }, /^file\./],
    ['public metadata', (file, model) => { model.public = true; }, /^file\./],
    ['client-editable object key', (file, model) => {
      model.fields.find(field => field.id === file.storageFields.objectKey).protected = false;
    }, /^file\./],
    ['text size', (file, model) => {
      model.fields.find(field => field.id === file.storageFields.byteSize).type = 'string';
    }, /^file\./],
    ['nullable owner', (file, model) => {
      model.fields.find(field => field.id === file.ownerField).nullable = true;
    }, /^file\./],
    ['unbounded state', (file, model) => {
      delete model.fields.find(field => field.id === file.storageFields.state).constraints;
    }, /^file\./],
    ['no unique intent', (file, model) => {
      model.indexes = model.indexes.filter(index => !index.fields.includes(file.storageFields.intentId));
    }, /^file\./],
  ];
  for (const [name, mutate, expected] of cases) {
    const module = structuredClone(positive);
    const file = module.contracts.files[0];
    const model = module.contracts.models.find(model => model.id === file.metadataModel.id);
    mutate(file, model);
    const result = validateModule(module);
    try { refused(result, expected); } catch (error) { error.message = `${name}: ${error.message}`; throw error; }
  }
});

function linkedFixture(){
  const module=JSON.parse(readFileSync(new URL('../../extensions/common/catalog/module/manifest.json',import.meta.url),'utf8'));
  const own=module.identity.id, ref=(kind,id)=>({moduleId:own,kind,id});
  module.compatibility.sdk='^1.3.0';
  const file=module.contracts.files.find(item=>item.id==='images');
  for(const tool of module.contracts.mcp.tools)delete tool.widgetCalls;
  file.linkedRead={audiences:['app'],permission:ref('permission','view'),linkModel:ref('model','product_media'),
    parentRelation:'product',referenceFields:{fileId:'file_id',intentId:'intent_id',generation:'generation',digest:'digest'},
    when:{field:'status',equals:'published'}};
  const permission=module.contracts.permissions.find(item=>item.id==='view');
  for(const item of [ref('model','file_metadata'),ref('file','images')])
    if(!permission.resources.some(existing=>existing.kind===item.kind&&existing.id===item.id))permission.resources.push(item);
  const metadata=module.contracts.models.find(item=>item.id==='file_metadata');
  if(!metadata.permissions.some(item=>item.id==='view'))metadata.permissions.push(ref('permission','view'));
  return module;
}

test('linked reads bind private files to a same-module scoped parent under an explicit read permission',()=>{
  accepted(validateModule(linkedFixture()));
  const cases=[
    ['unknown policy input',(m,p)=>{p.allowAnonymous=true;},'schema.invalid'],
    ['old SDK range',m=>{m.compatibility.sdk='^1.2.0';},'file.linked-sdk'],
    ['public category',m=>{m.contracts.files[0].public=true;},'file.linked-owner'],
    ['foreign link model',(m,p)=>{p.linkModel.moduleId='creezio.other';},/^file\.linked|^ref\./],
    ['missing relation',(m,p)=>{p.parentRelation='unknown';},'file.linked-relation'],
    ['aliased reference',(m,p)=>{p.referenceFields.digest=p.referenceFields.fileId;},'file.linked-fields'],
    ['invalid state',(m,p)=>{p.when.equals='unrecognized';},'file.linked-state'],
    ['unscoped parent',m=>{m.contracts.models.find(item=>item.id==='product').scope='application';},'file.linked-relation'],
    ['nullable link identity',m=>{m.contracts.models.find(item=>item.id==='product_media').fields.find(item=>item.id==='file_id').nullable=true;},'file.linked-fields'],
    ['no metadata read',m=>{m.contracts.models.find(item=>item.id==='file_metadata').permissions=m.contracts.models.find(item=>item.id==='file_metadata').permissions.filter(item=>item.id!=='view');},'file.linked-permission'],
    ['readable extra metadata column',m=>{m.contracts.models.find(item=>item.id==='file_metadata').fields.push({id:'extra',type:'string',protected:false,nullable:false,computed:false});},'file.linked-fields'],
    ['no file read',m=>{m.contracts.permissions.find(item=>item.id==='view').resources=m.contracts.permissions.find(item=>item.id==='view').resources.filter(item=>item.kind!=='file');},'file.linked-permission'],
    ['audience not allowed',m=>{m.contracts.permissions.find(item=>item.id==='view').audiences=['admin'];},'file.linked-permission'],
  ];
  for(const [name,mutate,expected] of cases){
    const module=linkedFixture();mutate(module,module.contracts.files[0].linkedRead);
    try{refused(validateModule(module),expected);}catch(error){error.message=`${name}: ${error.message}`;throw error;}
  }
});

test('widgetCalls alone requires SDK 1.5 while generic linked reads remain available in 1.3',()=>{
  const module=linkedFixture();
  accepted(validateModule(module));
  const media=module.contracts.mcp.tools.find(item=>item.operation.id==='media.list');
  media.widgetCalls=[{moduleId:module.identity.id,kind:'widget',id:'product-list'}];
  refused(validateModule(module),'mcp.widget-calls-sdk');
  module.compatibility.sdk='^1.5.0';
  accepted(validateModule(module));
});
