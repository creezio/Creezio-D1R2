import test from 'node:test';
import assert from 'node:assert/strict';
import {manifest,read} from '../helpers.mjs';
import {generateD1Schema} from '../../../../../scripts/data/d1-schema.mjs';

test('access owns private identity models and a deterministic relational schema',()=>{
 const models=JSON.parse(read('module/models.json'));
 assert.deepEqual(manifest.contracts.models,models);
 assert.equal(models.length,21);
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

test('machine credentials persist hashes and exact scope tuples without implicit account rights',()=>{
 const models=JSON.parse(read('module/models.json'));
 const credentials=models.find(model=>model.id==='api_credentials');
 const scopes=models.find(model=>model.id==='api_credential_scopes');
 assert.deepEqual(credentials.primaryKey,['id']);
 assert.deepEqual(credentials.fields.find(field=>field.id==='secret_hash').constraints,{minLength:71,maxLength:71});
 assert.ok(credentials.indexes.some(index=>index.unique&&JSON.stringify(index.fields)===JSON.stringify(['secret_hash'])));
 assert.ok(credentials.indexes.some(index=>index.unique&&JSON.stringify(index.fields)===JSON.stringify(['revocation_nonce'])));
 assert.ok(credentials.indexes.some(index=>JSON.stringify(index.fields)===JSON.stringify(['principal_id','auth_version','revoked_at_ms','expires_at_ms'])));
 assert.deepEqual(scopes.primaryKey,['credential_id','context_id','audience','permission_id']);
 assert.deepEqual(scopes.fields.find(field=>field.id==='audience').constraints.enum,['admin','app']);
 assert.deepEqual(scopes.relations.map(relation=>[relation.fields,relation.target.id,relation.targetFields,relation.onDelete]),[
  [['credential_id'],'api_credentials',['id'],'restrict'],[['context_id'],'contexts',['id'],'restrict']]);
 assert.equal(scopes.fields.some(field=>field.type==='json'),false,'scope pairing is represented in relational keys, never a flattened JSON grant');
 for(const name of ['token','secret','password_record','account_version','role_id'])assert.equal(credentials.fields.some(field=>field.id===name),false,name);
 const audit=models.find(model=>model.id==='access_audit');
 assert.equal(audit.fields.find(field=>field.id==='credential_id').nullable,true);
 assert.equal(audit.relations.some(relation=>relation.fields.includes('credential_id')),false,'credential reference is retained independently of token retention');
 for(const action of ['service-created','service-status-updated','api-token-issued','api-token-rotated','api-token-revoked'])
  assert.ok(audit.fields.find(field=>field.id==='action').constraints.enum.includes(action));
});

test('human administration keeps session targets historical and indexes bounded projections and invalidation',()=>{
 const models=JSON.parse(read('module/models.json')), byId=new Map(models.map(model=>[model.id,model]));
 const audit=byId.get('access_audit'), target=audit.fields.find(field=>field.id==='target_session_id');
 assert.equal(target.nullable,true);assert.equal(target.protected,true);
 assert.deepEqual(target.constraints,{minLength:1,maxLength:128});
 assert.equal(audit.relations.some(relation=>relation.fields.includes('target_session_id')),false,'a target session identifier is retained independently of session retention');
 assert.ok(audit.relations.some(relation=>relation.fields.includes('session_id')&&relation.target.id==='sessions'),'the actor session remains distinct from the target');
 for(const action of ['human-status-updated','human-sessions-revoked','human-session-revoked'])
  assert.ok(audit.fields.find(field=>field.id==='action').constraints.enum.includes(action));
 for(const [id,fields] of [
  ['principals',['kind','id']],['sessions',['principal_id','id']],
  ['sessions',['principal_id','auth_version','revoked_at_ms','expires_at_ms']],
  ['account_capabilities',['principal_id','auth_version','revoked_at_ms','consumed_at_ms','expires_at_ms']],
 ]) assert.ok(byId.get(id).indexes.some(index=>!index.unique&&JSON.stringify(index.fields)===JSON.stringify(fields)),`${id}: ${fields.join(',')}`);
 assert.deepEqual(byId.get('principals').fields.find(field=>field.id==='status').constraints.enum,['active','disabled']);
 assert.deepEqual(byId.get('human_accounts').fields.find(field=>field.id==='status').constraints.enum,['active','pending','disabled']);
});

test('impersonation models preserve distinct source and subject without constraining replaceable memberships',()=>{
 const models=JSON.parse(read('module/models.json')), byId=new Map(models.map(model=>[model.id,model]));
 const delegation=byId.get('impersonations'), ceiling=byId.get('impersonation_permissions');
 assert.deepEqual(delegation.primaryKey,['id']);
 assert.deepEqual(delegation.fields.find(f=>f.id==='secret_hash').constraints,{minLength:71,maxLength:71});
 for(const field of ['subject_auth_version','subject_account_version','subject_credential_version']){
  assert.equal(delegation.fields.find(f=>f.id===field).nullable,false);
  assert.equal(delegation.fields.find(f=>f.id===field).constraints.minimum,1);
 }
 assert.deepEqual(delegation.fields.find(f=>f.id==='audience').constraints.enum,['admin','app']);
 assert.deepEqual(delegation.relations.map(r=>[r.fields[0],r.target.id,r.onDelete]),[
  ['source_session_id','sessions','restrict'],['actor_principal_id','principals','restrict'],
  ['subject_principal_id','principals','restrict'],['context_id','contexts','restrict']]);
 assert.equal(delegation.relations.some(r=>r.target.id==='memberships'),false,'revoking membership must remain possible');
 assert.deepEqual(ceiling.primaryKey,['impersonation_id','permission_id']);
 assert.equal(ceiling.relations[0].target.id,'impersonations');
 for(const field of ['secret_hash','revocation_nonce'])assert.ok(delegation.indexes.some(i=>i.unique&&i.fields.length===1&&i.fields[0]===field));
 assert.ok(delegation.indexes.some(i=>JSON.stringify(i.fields)===JSON.stringify(['source_session_id','ended_at_ms','expires_at_ms'])));
 assert.ok(delegation.indexes.some(i=>JSON.stringify(i.fields)===JSON.stringify(['ended_at_ms','expires_at_ms'])));
 const audit=byId.get('access_audit');
 for(const field of ['impersonation_id','context_id','audience']){
  assert.equal(audit.fields.find(f=>f.id===field).nullable,true);
  assert.equal(audit.relations.some(r=>r.fields.includes(field)),false,'audit references remain historical');
 }
 for(const action of ['impersonation-started','impersonation-stopped'])assert.ok(audit.fields.find(f=>f.id==='action').constraints.enum.includes(action));
 assert.deepEqual(audit.fields.find(f=>f.id==='audience').constraints.enum,[null,'admin','app'],'historical audit permits omitted audience without allowing unknown values');
 for(const id of ['manage','impersonate']){
  const permission=manifest.contracts.permissions.find(p=>p.id===id);
  assert.deepEqual(permission.actors,['user']);assert.deepEqual(permission.audiences,['admin']);
  assert.equal(permission.context,'application');assert.equal(permission.default,'deny');
 }
});
