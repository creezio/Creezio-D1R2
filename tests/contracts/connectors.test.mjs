import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateModule} from '../../sdk/contracts/validate.mjs';
import {accepted,refused} from './helpers.mjs';

const source=new URL('../../extensions/connectors/n8n/module/manifest.json',import.meta.url);
const fixture=()=>JSON.parse(readFileSync(source,'utf8'));
const resendSource=new URL('../../extensions/connectors/resend/module/manifest.json',import.meta.url);
const resendFixture=()=>JSON.parse(readFileSync(resendSource,'utf8'));

test('a declared n8n GET route is an outbound resource, not a package file reference',()=>{
  const module=fixture();
  const connector=module.contracts.connectors[0];
  assert.equal(connector.moduleId,module.identity.id);
  assert.ok(connector.resources.some(item=>item.path==='/api/v1/workflows/{id}'));
  for(const item of connector.resources)
    assert.equal(module.packaging.runtime.files.includes(item.path),false);
  accepted(validateModule(module));
  const broken=fixture();
  broken.contracts.ui.views[0].component.path='ui/not-packaged.tsx';
  refused(validateModule(broken),'path.missing');
});

test('connector storage cannot point at another module or an undeclared model',()=>{
  for(const [name,mutate] of [
    ['foreign storage module',connector=>{connector.vault.moduleId='creezio.crm';}],
    ['foreign model',connector=>{connector.config.modelId='crm_contact';}],
  ]){
    const module=fixture();mutate(module.contracts.connectors[0]);
    try{refused(validateModule(module),/^connector\./);}
    catch(error){error.message=`${name}: ${error.message}`;throw error;}
  }
});

test('vault mappings must have the field types and bounds required by the host',()=>{
  const cases=[
    ['ciphertext type',model=>{model.fields.find(field=>field.id==='ciphertext').type='integer';}],
    ['version bound',model=>{delete model.fields.find(field=>field.id==='version').constraints;}],
    ['state enum',model=>{model.fields.find(field=>field.id==='state').constraints.enum=['active'];}],
  ];
  for(const [name,mutate] of cases){
    const module=fixture();
    mutate(module.contracts.models.find(model=>model.id===module.contracts.connectors[0].vault.modelId));
    try{refused(validateModule(module),/^connector\./);}
    catch(error){error.message=`${name}: ${error.message}`;throw error;}
  }
});

test('connector configuration keeps a private context and positive key version',()=>{
  const cases=[
    ['public config model',model=>{model.public=true;}],
    ['unprotected context',model=>{model.fields.find(field=>field.id==='context_id').protected=false;}],
    ['zero secret version',model=>{model.fields.find(field=>field.id==='secret_version').constraints.minimum=0;}],
  ];
  for(const [name,mutate] of cases){
    const module=fixture();
    mutate(module.contracts.models.find(model=>model.id===module.contracts.connectors[0].config.modelId));
    try{refused(validateModule(module),/^connector\./);}
    catch(error){error.message=`${name}: ${error.message}`;throw error;}
  }
});

test('connector identifiers are unique and the module declaration is bounded',()=>{
  const duplicate=fixture();
  duplicate.contracts.connectors.push(structuredClone(duplicate.contracts.connectors[0]));
  refused(validateModule(duplicate),'duplicate.id');
  const excessive=fixture(),original=excessive.contracts.connectors[0];
  excessive.contracts.connectors=Array.from({length:17},(_,index)=>
    ({...structuredClone(original),id:`n8n.extra.${index}`}));
  refused(validateModule(excessive),'schema.invalid');
});

test('a connector cannot select a system header or a traversing outbound path',()=>{
  const cases=[
    ['Host header',connector=>{connector.auth.name='Host';},'schema.invalid'],
    ['forwarded host header',connector=>{connector.auth.name='X-Forwarded-Host';},'connector.auth'],
    ['parent path',connector=>{connector.resources[0].path='/api/v1/../credentials';},'connector.resource'],
    ['encoded parent path',connector=>{connector.resources[0].path='/api/v1/%2e%2e/credentials';},'schema.invalid'],
    ['undeclared path parameter',connector=>{connector.resources[0].path='/api/v1/workflows/{id}';},'connector.resource'],
  ];
  for(const [name,mutate,expected] of cases){
    const module=fixture();mutate(module.contracts.connectors[0]);
    try{refused(validateModule(module),expected);}
    catch(error){error.message=`${name}: ${error.message}`;throw error;}
  }
});

test('a module can fix its provider origin, protocol version and pagination names',()=>{
  const module=fixture(),connector=module.contracts.connectors[0];
  connector.fixedOrigin='https://api.stripe.com';
  connector.staticHeaders=[{name:'Stripe-Version',value:'2026-08-26.dahlia'}];
  connector.resources[0].query={cursor:'starting_after',limit:'limit',fixed:[{name:'status',value:'all'}]};
  accepted(validateModule(module));
});

test('fixed provider origins cannot contain routing overrides or local destinations',()=>{
  for(const origin of ['http://api.stripe.com','https://api.stripe.com/',
    'https://api.stripe.com/v1','https://key@api.stripe.com','https://api.stripe.com?other=1',
    'https://127.0.0.1','https://[::1]','https://localhost','https://service.internal',
    'https://api.stripe.com.']){
    const module=fixture();module.contracts.connectors[0].fixedOrigin=origin;
    refused(validateModule(module),'connector.origin');
  }
});

test('static connector headers cannot replace authority, credentials or host transport policy',()=>{
  for(const name of ['aUtHoRiZaTiOn','Proxy-Authorization','Host','Cookie','Set-Cookie',
    'Origin','Referer','Accept','Content-Type','Content-Length','Connection','Transfer-Encoding',
    'Cache-Control','Range','If-Match','Sec-Fetch-Site','X-Forwarded-Host','Forwarded',
    'X-N8N-API-KEY']){
    const module=fixture();module.contracts.connectors[0].staticHeaders=[{name,value:'fixed'}];
    refused(validateModule(module),'connector.header');
  }
  const duplicate=fixture();
  duplicate.contracts.connectors[0].staticHeaders=[{name:'Api-Version',value:'v1'},{name:'api-version',value:'v2'}];
  refused(validateModule(duplicate),'connector.header');
});

test('static header and query values are bounded protocol constants',()=>{
  for(const mutate of [
    connector=>{connector.staticHeaders=[{name:'Api-Version',value:'v1\r\nHost: other'}];},
    connector=>{connector.staticHeaders=[{name:'Api-Version',value:'v1\n'}];},
    connector=>{connector.staticHeaders=[{name:'Api-Version\n',value:'v1'}];},
    connector=>{connector.staticHeaders=[{name:'Api-Version',value:'x'.repeat(257)}];},
    connector=>{connector.staticHeaders=Array.from({length:9},(_,i)=>({name:`Api-${i}`,value:'v1'}));},
    connector=>{connector.resources[0].query={fixed:[{name:'status',value:'all\nother'}]};},
    connector=>{connector.resources[0].query={cursor:'start&other=1'};},
    connector=>{connector.resources[0].query={cursor:'starting_after\n'};},
    connector=>{connector.resources[0].query={fixed:[{name:'status',value:'all\u2028'}]};},
    connector=>{connector.resources[0].query={fixed:Array.from({length:9},(_,i)=>({name:`field_${i}`,value:'v1'}))};},
    connector=>{connector.resources[0].query={url:'https://other.example'};},
  ]){
    const module=fixture();mutate(module.contracts.connectors[0]);
    refused(validateModule(module),'schema.invalid');
  }
});

test('query mappings cannot shadow a dynamic parameter or enable undeclared input',()=>{
  for(const mutate of [
    resource=>{resource.query={cursor:'same',limit:'same'};},
    resource=>{resource.query={fixed:[{name:'cursor',value:'fixed'}]};},
    resource=>{resource.query={cursor:'starting_after',fixed:[{name:'starting_after',value:'fixed'}]};},
    resource=>{resource.query={fixed:[{name:'status',value:'all'},{name:'status',value:'active'}]};},
    resource=>{resource.params=[];resource.query={cursor:'starting_after'};},
  ]){
    const module=fixture();mutate(module.contracts.connectors[0].resources[0]);
    refused(validateModule(module),'connector.query');
  }
});

test('binary downloads require fixed provenance, event index and CDN origin',()=>{
  accepted(validateModule(resendFixture()));
  for(const mutate of [
    policy=>{policy.cdnOrigin='https://other.example.invalid/path';},
    policy=>{policy.metadataPath='/mail/{parentId}/../{childId}';},
    policy=>{policy.proofOperationId='domain.list';},
    policy=>{policy.event.indexId='missing-index';},
  ]){
    const module=resendFixture();mutate(module.contracts.connectors[0].binaryDownloads[0]);
    assert.ok(validateModule(module).errors.length>0);
  }
  const missing=resendFixture();delete missing.contracts.connectors[0].config.fields.connectionId;
  refused(validateModule(missing),'connector.binary');
});
