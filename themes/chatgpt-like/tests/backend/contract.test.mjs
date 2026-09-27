import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {create} from '../../module/entry.server.ts';

test('ChatGPT-like theme has no backend data or operation capability', () => {
  const manifest=JSON.parse(readFileSync(new URL('../../module/manifest.json',import.meta.url)));
  assert.deepEqual(create(),{id:manifest.identity.id,version:manifest.identity.version});
  for(const key of ['models','files','permissions','operations','events','settings','search'])
    assert.deepEqual(manifest.contracts[key],[],key);
});
