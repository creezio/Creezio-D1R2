import test from 'node:test';
import assert from 'node:assert/strict';
import {manifest,read} from '../helpers.mjs';
import {generateD1Schema} from '../../../../../scripts/data/d1-schema.mjs';

test('access owns private identity models and a deterministic relational schema',()=>{
 const models=JSON.parse(read('module/models.json'));
 assert.deepEqual(manifest.contracts.models,models);
 assert.ok(models.length>=8);
 for(const model of models){assert.equal(model.public,false);assert.ok(model.fields.every(field=>field.protected));}
 const generated=generateD1Schema(manifest.identity.id,models);
 assert.equal(Object.keys(generated.tables).length,models.length);
 assert.match(generated.sql,/CREATE TABLE/);
 assert.doesNotMatch(generated.sql,/IF NOT EXISTS/);
});
