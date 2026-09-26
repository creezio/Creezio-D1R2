import test from 'node:test';
import assert from 'node:assert/strict';
import {manifest,read} from '../helpers.mjs';
import {generateD1Schema} from '../../../../../scripts/data/d1-schema.mjs';

test('access owns private identity models and a deterministic relational schema',()=>{
 const models=JSON.parse(read('module/models.json'));
 assert.deepEqual(manifest.contracts.models,models);
 assert.equal(models.length,16);
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
