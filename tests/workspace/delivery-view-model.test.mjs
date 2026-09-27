import test from 'node:test';
import assert from 'node:assert/strict';
import {deliveryViewModel} from '../../sdk/delivery/view-model.ts';

const ready = {profile: 'docker-local', connection: 'connected', configuration: 'ready',
  preparation: 'ready', planReviewed: true, transfer: null};

test('only a prepared local profile can start, with a visible capture notice', () => {
  const model = deliveryViewModel(ready);
  assert.equal(model.canStart, true);
  assert.equal(model.showCaptureNotice, true);
  assert.equal(model.transferId, null);
  assert.equal(deliveryViewModel({...ready, preparation: 'needed'}).canStart, false);
  assert.equal(deliveryViewModel({...ready, planReviewed: false}).canStart, false);
});

test('a lost operator connection preserves transfer identity and permits refresh', () => {
  const model = deliveryViewModel({...ready, connection: 'unavailable',
    transfer: {id: 'transfer-1', phase: 'r2-copying'}});
  assert.equal(model.transferId, 'transfer-1');
  assert.equal(model.canRefresh, true);
  assert.equal(model.canStart, false);
  assert.equal(model.canReconcile, false);
  assert.deepEqual(model.steps.map(step => step.status),
    ['done', 'done', 'done', 'current', 'waiting', 'waiting', 'waiting']);
});

test('uncertain delivery stays attached to the same transfer', () => {
  const model = deliveryViewModel({...ready,
    transfer: {id: 'transfer-2', phase: 'delivery-unknown'}});
  assert.equal(model.canStart, false);
  assert.equal(model.canReconcile, true);
  assert.equal(model.steps.at(-1).status, 'attention');
  assert.match(model.detail, /même transfert/);
});
