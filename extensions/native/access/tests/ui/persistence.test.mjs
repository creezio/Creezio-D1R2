import test from 'node:test';
import assert from 'node:assert/strict';
import {createPanelCommandPersistence} from '../../ui/persistence.ts';

test('pending command key is saved before mutation and cleared without losing panel position', () => {
  let state = {scrollTop: 42, activeSubview: 'users', data: {}};
  const navigation = {
    readPanelState: () => state,
    savePanelState: next => { state = structuredClone(next); return true; }
  };
  const store = createPanelCommandPersistence(navigation);
  const pending = {bindingId: 'creezio.access:policy.apply-delta',
    requestKey: '4db5e922-d00f-49f1-985c-9d2b119096a3'};
  assert.equal(store.read(), null);
  assert.equal(store.save(pending), true);
  assert.deepEqual(store.read(), pending);
  assert.equal(state.scrollTop, 42);
  assert.equal(state.activeSubview, 'users');
  assert.equal(store.save(null), true);
  assert.equal(store.read(), null);
  assert.deepEqual(state.data, {});
});

test('persistence failure propagates so the SDK blocks an unsafe command', () => {
  const store = createPanelCommandPersistence({readPanelState: () => null, savePanelState: () => false});
  assert.equal(store.save({bindingId: 'creezio.access:sessions.revoke', requestKey: 'key'}), false);
  assert.equal(store.read(), null);
});
