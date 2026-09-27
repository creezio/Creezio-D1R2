import test from 'node:test';
import assert from 'node:assert/strict';
import {manifest,read} from '../helpers.mjs';
import {generateD1Schema} from '../../../../../scripts/data/d1-schema.mjs';
test('private module plans use one revision head and preserve historical decisions',()=>{
  const models=JSON.parse(read('module/models.json'));
  assert.deepEqual(models,manifest.contracts.models);
  assert.deepEqual(models.map(model=>model.id),['head','plans','journal']);
  assert.ok(models.every(model=>!model.public&&model.scope==='application'));
  assert.deepEqual(models.find(model=>model.id==='journal').primaryKey,['revision']);
  assert.ok(generateD1Schema(manifest.identity.id,models).sql.includes('CREATE TABLE'));
  const accept=manifest.contracts.operations.find(op=>op.id==='plans.accept');
  assert.deepEqual(accept.effects.writes.map(ref=>ref.id),['head','plans','journal']);
  assert.equal(accept.idempotency.mode,'required');
  assert.equal(manifest.lifecycle.deactivation,'preserve-data');
});
