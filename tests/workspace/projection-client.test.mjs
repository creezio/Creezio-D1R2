import test from 'node:test';
import assert from 'node:assert/strict';
import {acceptProjection,readProjection,WorkspaceAccessRefused} from '../../app/workspace/projection-client.ts';

test('host rejects stale identity, audience, context, composition and malformed projection', () => {
  const session = {id:'session-a', principalId:'principal-a', audience:'admin'};
  const expected = {session, contextId:'application', compositionDigest:`sha256-${'a'.repeat(64)}`};
  const projection = {sessionId:session.id, principalId:session.principalId, audience:session.audience,
    contextId:expected.contextId, compositionDigest:expected.compositionDigest, epoch:3,
    viewIds:['example.notes:edit'], navigationIds:['example.notes:home']};
  const value = acceptProjection({projection}, expected);
  assert.ok(value); assert.ok(Object.isFrozen(value)); assert.ok(Object.isFrozen(value.viewIds));
  for (const [key, changed] of Object.entries({sessionId:'other',principalId:'other',audience:'app',contextId:'other',compositionDigest:'wrong',epoch:-1,
    viewIds:['example.notes:edit','example.notes:edit'],navigationIds:['invalid']})) {
    assert.equal(acceptProjection({projection:{...projection,[key]:changed}}, expected), null, key);
  }
  assert.equal(acceptProjection({projection:{...projection,secret:'unexpected'}}, expected), null);
  projection.viewIds.push('example.notes:second'); assert.equal(value.viewIds.length, 1);
});

test('a confirmed authorization refusal differs from a transient projection outage', async t => {
  const options={origin:'https://creezio.example',session:{id:'session-a',audience:'admin'},contextId:'application',compositionDigest:'digest',signal:new AbortController().signal};
  for(const status of [401,403,503]) {
    t.mock.method(globalThis,'fetch',async()=>new Response('unavailable',{status}));
    await assert.rejects(readProjection(options),error => (error instanceof WorkspaceAccessRefused)===(status!==503));
    t.mock.restoreAll();
  }
});
