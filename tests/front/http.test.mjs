import test from 'node:test';
import assert from 'node:assert/strict';
import {dispatchFrontHttp} from '../../core/front/http.ts';

const origin='https://creezio.example';
const options={permissions:[],catalog:{compositionDigest:`sha256-${'a'.repeat(64)}`,views:[],navigation:[],slots:[]}};
const environment={profile:'sites',bindings:{DB:{prepare(){assert.fail('Preflight must not touch D1');}}}};
const raw={CREEZIO_APP_ORIGIN:origin};
const dispatch=(url,init)=>dispatchFrontHttp(new Request(url,init),environment,raw,'request-1',options);

test('front projection is a same-origin app-cookie GET with no bearer transport',async()=>{
  assert.equal(await dispatch(`${origin}/api/other`),null);
  const method=await dispatch(`${origin}/api/front/projection`,{method:'POST'});
  assert.equal(method.status,405);assert.equal(method.headers.get('allow'),'GET');
  const remote=await dispatch(`${origin}/api/front/projection`,{headers:{origin:'https://evil.example'}});
  assert.equal(remote.status,403);
  const crossSite=await dispatch(`${origin}/api/front/projection`,{headers:{'sec-fetch-site':'cross-site'}});
  assert.equal(crossSite.status,403);
  const bearer=await dispatch(`${origin}/api/front/projection`,{headers:{authorization:'Bearer synthetic'}});
  assert.equal(bearer.status,401);
  const anonymous=await dispatch(`${origin}/api/front/projection`);
  assert.equal(anonymous.status,401);
  assert.equal(anonymous.headers.get('cache-control'),'no-store');
  const query=await dispatch(`${origin}/api/front/projection?x=1`);
  assert.equal(query.status,400);
});
