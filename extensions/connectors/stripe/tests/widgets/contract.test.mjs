import test from 'node:test';
import assert from 'node:assert/strict';
import {manifest,read} from '../helpers.mjs';

test('billing status widget is a read-only view with one explicit refresh action',()=>{
  const widget=manifest.contracts.widgets[0];
  assert.equal(widget.id,'sync-status');
  assert.deepEqual(widget.audiences,['admin']);
  assert.deepEqual(widget.actions.map(row=>row.target.operation.id),['sync.state']);
  assert.equal(manifest.contracts.mcp.tools.find(row=>row.id==='sync.state').widget.id,'sync-status');
  const source=read('ui/widgets/sync-status.ts');
  assert.match(source,/stripe_sync_state/u);
  assert.doesNotMatch(source,/stripe_sync_page|stripe_sync_start|fetch\(/u);
  assert.match(source,/pages partielles|Lecture partielle/u);
});
