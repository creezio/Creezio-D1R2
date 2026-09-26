import test from 'node:test';
import assert from 'node:assert/strict';
import {manifest,read} from '../helpers.mjs';
import {generateD1Schema} from '../../../../../scripts/data/d1-schema.mjs';

test('access owns private identity models and a deterministic relational schema',()=>{
 const models=JSON.parse(read('module/models.json'));
 assert.deepEqual(manifest.contracts.models,models);
 assert.equal(models.length,17);
 for(const model of models){assert.equal(model.public,false);assert.ok(model.fields.every(field=>field.protected));}
 const generated=generateD1Schema(manifest.identity.id,models);
 assert.equal(Object.keys(generated.tables).length,models.length);
 assert.match(generated.sql,/CREATE TABLE/);
 assert.doesNotMatch(generated.sql,/IF NOT EXISTS/);
});

test('authorization models bind assignments and exceptions to exact principal/context/audience memberships',()=>{
 const models=JSON.parse(read('module/models.json'));
 const byId=new Map(models.map(model=>[model.id,model]));
 const membershipKey=['principal_id','context_id','audience'];
 assert.deepEqual(byId.get('memberships').primaryKey,membershipKey);
 for(const id of ['role_assignments','principal_overrides']){
  const relation=byId.get(id).relations.find(relation=>relation.target.id==='memberships');
  assert.ok(relation,`${id} needs a membership foreign key`);
  assert.deepEqual(relation.fields,membershipKey);
  assert.deepEqual(relation.targetFields,membershipKey);
  assert.equal(relation.onDelete,'restrict');
 }
 for(const id of ['role_grants','role_overrides']){
  const model=byId.get(id);
  assert.deepEqual(model.primaryKey,['role_id','permission_id']);
  assert.equal(model.fields.find(field=>field.id==='permission_id').constraints.maxLength,256);
  assert.equal(model.relations.find(relation=>relation.id==='role').target.id,'roles');
 }
 for(const id of ['contexts','memberships','roles','role_parents','role_grants','role_overrides','role_assignments','principal_overrides']){
  const model=byId.get(id);
  assert.equal(model.scope,'application');
  assert.ok(model.relations.every(relation=>relation.onDelete==='restrict'));
  assert.equal(model.fields.some(field=>field.id==='version'),false,'one global authorization epoch owns concurrency');
 }
 assert.deepEqual(byId.get('role_overrides').fields.find(field=>field.id==='effect').constraints.enum,['allow','deny']);
 assert.deepEqual(byId.get('principal_overrides').fields.find(field=>field.id==='effect').constraints.enum,['allow','deny']);
 assert.ok(byId.get('access_audit').fields.find(field=>field.id==='action').constraints.enum.includes('authorization-updated'));
});

test('account capabilities own purpose-bound target snapshots and never embed grants or clear credentials',()=>{
 const models=JSON.parse(read('module/models.json'));
 const capability=models.find(model=>model.id==='account_capabilities');
 const fields=new Map(capability.fields.map(field=>[field.id,field]));
 assert.deepEqual(fields.get('purpose').constraints.enum,['invitation','activation','password-reset']);
 for(const id of ['auth_version','account_version']){
  assert.equal(fields.get(id).nullable,false);assert.equal(fields.get(id).constraints.minimum,1);
 }
 assert.equal(fields.get('credential_version').nullable,true,'pending accounts have no password credential yet');
 for(const id of ['consumed_at_ms','revoked_at_ms','claim_nonce'])assert.equal(fields.get(id).nullable,true);
 for(const id of ['secret_hash','claim_nonce'])assert.ok(capability.indexes.some(index=>index.unique&&index.fields.length===1&&index.fields[0]===id));
 assert.deepEqual(fields.get('secret_hash').constraints,{minLength:71,maxLength:71});
 assert.deepEqual(capability.relations.map(relation=>[relation.fields,relation.target.id,relation.onDelete]),[[['principal_id'],'principals','restrict']]);
 for(const id of ['token','secret','password_record','role_id','context_id','permission_id'])assert.equal(fields.has(id),false,id);
 const audit=models.find(model=>model.id==='access_audit');
 const actions=audit.fields.find(field=>field.id==='action').constraints.enum;
 for(const action of ['capability-issued','capability-revoked','account-activated','password-reset'])assert.ok(actions.includes(action));
 assert.ok(audit.relations.some(relation=>relation.fields[0]==='target_principal_id'&&relation.target.id==='principals'&&relation.onDelete==='restrict'));
 assert.equal(audit.relations.some(relation=>relation.fields.includes('capability_id')),false,'history must not require the capability row to survive');
 assert.ok(capability.indexes.some(index=>JSON.stringify(index.fields)===JSON.stringify(['principal_id','revoked_at_ms','consumed_at_ms','expires_at_ms'])),'outstanding target capabilities need a selective index');
 assert.ok(capability.indexes.some(index=>JSON.stringify(index.fields)===JSON.stringify(['revoked_at_ms','consumed_at_ms','expires_at_ms'])),'global outstanding count must not scan consumed history');
 assert.ok(models.find(model=>model.id==='sessions').indexes.some(index=>JSON.stringify(index.fields)===JSON.stringify(['principal_id','revoked_at_ms','expires_at_ms'])),'live target sessions need a selective index');
});
