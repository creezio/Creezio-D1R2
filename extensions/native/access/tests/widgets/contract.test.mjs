import test from 'node:test';import assert from 'node:assert/strict';import {manifest} from '../helpers.mjs';
test('no conversational widget can expose identity data in storage-only slice',()=>{assert.deepEqual(manifest.contracts.widgets,[]);assert.deepEqual(manifest.contracts.mcp.resources,[]);assert.equal(manifest.lifecycle.absent.widgets.policyRule,'access.storage-only.widgets');});
