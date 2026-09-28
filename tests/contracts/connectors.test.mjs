import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateModule} from '../../sdk/contracts/validate.mjs';
import {accepted,refused} from './helpers.mjs';

const source=new URL('../../extensions/connectors/n8n/module/manifest.json',import.meta.url);
const fixture=()=>JSON.parse(readFileSync(source,'utf8'));

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
