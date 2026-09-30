import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateModule} from '../../sdk/contracts/validate.mjs';

const manifest=JSON.parse(readFileSync(new URL('../../extensions/native/messaging/module/manifest.json',
  import.meta.url),'utf8'));

test('module-owned delivery declaration binds a command, immutable preparation and private projector models',()=>{
  assert.deepEqual(validateModule(manifest).errors,[]);
  const invalid=structuredClone(manifest);
  invalid.contracts.deliveries[0].models[0]={moduleId:'creezio.resend',kind:'model',id:'connector_config'};
  assert.ok(validateModule(invalid).errors.some(error=>error.code==='delivery.model'));
});

test('delivery cannot drop its durable intent binding or provider dependency guard',()=>{
  const missingIntent=structuredClone(manifest);
  missingIntent.contracts.deliveries[0].prepareInput.intentId='messageId';
  assert.ok(validateModule(missingIntent).errors.some(error=>error.code==='delivery.prepare'));
  const missingGuard=structuredClone(manifest);
  missingGuard.contracts.deliveries[0].requiresModules=[];
  assert.ok(validateModule(missingGuard).errors.some(error=>error.code==='dependency.guard'));
});

test('delivery preparation requires its intent ID and matched integer provider revision',()=>{
  const missingOutputIntent=structuredClone(manifest);
  const output=missingOutputIntent.contracts.schemas.find(item=>item.id==='message-delivery-prepare-output').schema;
  output.required=output.required.filter(field=>field!=='intentId');
  assert.ok(validateModule(missingOutputIntent).errors.some(error=>error.code==='delivery.prepare'));

  const unmatchedRevision=structuredClone(manifest);
  unmatchedRevision.contracts.deliveries[0].matchFields=
    unmatchedRevision.contracts.deliveries[0].matchFields.filter(field=>field!=='configRevision');
  assert.ok(validateModule(unmatchedRevision).errors.some(error=>error.code==='delivery.prepare'));

  const nonIntegerRevision=structuredClone(manifest);
  nonIntegerRevision.contracts.schemas.find(item=>item.id==='message-delivery-prepare-output')
    .schema.properties.configRevision.type='string';
  assert.ok(validateModule(nonIntegerRevision).errors.some(error=>error.code==='delivery.prepare'));
});
