import test from 'node:test';import assert from 'node:assert/strict';
import {manifest} from '../helpers.mjs';
test('list and module details have declared persistent identities and administrative rights',()=>{
  const views=manifest.contracts.ui.views;
  assert.deepEqual(views.map(view=>view.component.export),['ModulesListView','ModuleDetailView']);
  assert.deepEqual(views.map(view=>view.panel.identityFields),[[],['moduleId']]);
  assert.ok(views.every(view=>view.panel.retention==='preserve'&&view.panel.navigation==='sdk'));
  assert.ok(views.every(view=>view.permissions[0].moduleId===manifest.identity.id));
  const state=manifest.contracts.schemas.find(item=>item.id==='panel-state').schema;
  assert.equal(state.additionalProperties,false);
  assert.deepEqual(Object.keys(state.properties),['pendingRequestKey','pendingOwner']);
  assert.equal(manifest.contracts.ui.front.mode,'absent');
});
