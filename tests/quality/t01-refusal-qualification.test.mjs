import test from 'node:test';
import assert from 'node:assert/strict';

// T-01 negative candidate. This intentional failure must never reach main.
// A following commit removes this fixture only after the required gate is red.
test('T-01 qualification: a failing candidate must be blocked by the required gate', () => {
  assert.fail('EXPECTED_T01_QUALIFICATION_REFUSAL');
});
