import test from 'node:test';
import assert from 'node:assert/strict';
import {dispatchOAuthHttp,OAUTH_HTTP_BODY_DEADLINE_MS} from '../../core/oauth/http.ts';

const registerEnvironment = {profile:'local',bindings:{DB:{
  prepare() { return {bind() { return {}; }}; },
  async batch() { return [{success:true,results:[]},
    {success:true,results:[{attempts:1,retryAtMs:Date.now()+60_000}]}]; },
}}};
const register = request => dispatchOAuthHttp(request,registerEnvironment,
  {CREEZIO_APP_ORIGIN:'http://localhost:8787'},[],
  'oauth-register-policy','/oauth/register',{admin:true,app:false});

test('OAuth registration keeps body admission errors distinct from malformed JSON', async () => {
  const endpoint = 'http://localhost:8787/oauth/register';
  const oversized = await register(new Request(endpoint,{method:'POST',
    headers:{'content-type':'application/json'},body:'x'.repeat(16_385)}));
  assert.equal(oversized.status,413);
  assert.deepEqual(await oversized.json(),{error:'invalid_request'});
  const malformed = await register(new Request(endpoint,{method:'POST',
    headers:{'content-type':'application/json'},body:'{'}));
  assert.equal(malformed.status,400);
  assert.deepEqual(await malformed.json(),{error:'invalid_client_metadata'});

  const controller = new AbortController();
  let cancelled = 0;
  const body = new ReadableStream({cancel() { cancelled++; return new Promise(()=>{}); }});
  const pending = register(new Request(endpoint,{method:'POST',
    headers:{'content-type':'application/json'},body,duplex:'half',signal:controller.signal}));
  controller.abort();
  const aborted = await pending;
  assert.equal(aborted.status,499);
  assert.deepEqual(await aborted.json(),{error:'request_cancelled'});
  assert.equal(cancelled,1);
});

test('a stalled OAuth token body is cancelled at the fixed reception deadline', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  let cancelled = 0;
  const body = new ReadableStream({cancel() { cancelled++; return new Promise(()=>{}); }});
  const request = new Request('http://localhost:8787/oauth/token',{method:'POST',
    headers:{'content-type':'application/x-www-form-urlencoded'},body,duplex:'half'});
  const environment = {profile:'local',bindings:{DB:{prepare() { throw new Error('No D1 read expected'); }}}};
  const response = dispatchOAuthHttp(request,environment,{CREEZIO_APP_ORIGIN:'http://localhost:8787'},
    [],'oauth-deadline','/oauth/token',{admin:true,app:false});
  t.mock.timers.tick(OAUTH_HTTP_BODY_DEADLINE_MS);
  const result = await response;
  assert.equal(result.status,408);
  assert.deepEqual(await result.json(),{error:'body_timeout'});
  assert.equal(cancelled,1);
});

test('an aborted OAuth token body stops reception immediately', async () => {
  const controller = new AbortController(); let cancelled = 0;
  const body = new ReadableStream({cancel() { cancelled++; return new Promise(()=>{}); }});
  const request = new Request('http://localhost:8787/oauth/token',{method:'POST',
    headers:{'content-type':'application/x-www-form-urlencoded'},body,duplex:'half',signal:controller.signal});
  const environment = {profile:'local',bindings:{DB:{prepare() { throw new Error('No D1 read expected'); }}}};
  const response = dispatchOAuthHttp(request,environment,{CREEZIO_APP_ORIGIN:'http://localhost:8787'},
    [],'oauth-aborted','/oauth/token',{admin:true,app:false});
  controller.abort();
  const result = await response;
  assert.equal(result.status,499);
  assert.deepEqual(await result.json(),{error:'request_cancelled'});
  assert.equal(cancelled,1);
});
