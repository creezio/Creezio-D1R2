import test from 'node:test';
import assert from 'node:assert/strict';
import {acceptFrontProjection,readFrontProjection,FrontAccessRefused} from '../../app/front/projection-client.ts';

const session={id:'session-app',principalId:'person',audience:'app'};
const expected={session,contextId:'application',compositionDigest:`sha256-${'a'.repeat(64)}`};
const projection={sessionId:session.id,principalId:session.principalId,audience:'app',
  contextId:expected.contextId,compositionDigest:expected.compositionDigest,epoch:4,
  viewIds:['example.notes:list'],navigationIds:['example.notes:list-nav'],slotIds:['example.notes:list-slot']};

test('front host accepts only the exact verified app session, context and projection shape',()=>{
  const accepted=acceptFrontProjection({projection},expected);
  assert.ok(accepted);assert.ok(Object.isFrozen(accepted.slotIds));
  for(const [key,changed] of Object.entries({sessionId:'other',principalId:'other',audience:'admin',
    contextId:'other',compositionDigest:'wrong',epoch:-1,viewIds:['example.notes:list','example.notes:list'],
    navigationIds:['invalid'],slotIds:['example.notes:list-slot','example.notes:list-slot']}))
    assert.equal(acceptFrontProjection({projection:{...projection,[key]:changed}},expected),null,key);
  assert.equal(acceptFrontProjection({projection:{...projection,token:'secret'}},expected),null);
  assert.equal(acceptFrontProjection({projection},{...expected,session:{...session,audience:'admin'}}),null);
});

test('projection request is same-origin cookie-only and separates rejection from outage',async t=>{
  const options={origin:'https://creezio.example',session,contextId:'application',
    compositionDigest:expected.compositionDigest,signal:new AbortController().signal};
  t.mock.method(globalThis,'fetch',async(url,init)=>{
    assert.equal(url,'https://creezio.example/api/front/projection');
    assert.equal(init.credentials,'same-origin');assert.equal(init.mode,'same-origin');
    assert.equal(init.redirect,'error');assert.equal(init.headers['x-creezio-context'],'application');
    assert.equal(init.headers.authorization,undefined);
    return Response.json({projection});
  });
  assert.deepEqual(await readFrontProjection(options),projection);
  t.mock.restoreAll();
  for(const status of [401,403,503]) {
    t.mock.method(globalThis,'fetch',async()=>new Response('unavailable',{status}));
    await assert.rejects(readFrontProjection(options),error=>(error instanceof FrontAccessRefused)===(status!==503));
    t.mock.restoreAll();
  }
});
