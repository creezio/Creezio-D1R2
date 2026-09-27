import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {generateD1Schema} from '../../scripts/data/d1-schema.mjs';
import {widgetSandboxOrigin} from '../../core/widgets/http.ts';
import {compileWidgetSandbox} from '../../scripts/widgets/sandbox.mjs';

const origin = 'https://widgets.example.invalid',digest=`sha256-${'a'.repeat(64)}`;
const uri = `ui://creezio/example.notes/card/1.0.0/${digest}.html`;
const root = new URL('../../',import.meta.url);

test('sandbox deployment requires an explicit distinct origin and refuses remote HTTP', () => {
  for (const value of [origin,'http://remote.example.invalid','https://proxy.invalid/path','https://proxy.invalid/'])
    assert.equal(widgetSandboxOrigin({CREEZIO_WIDGET_SANDBOX_ORIGIN:value},'sites',origin),null);
  assert.equal(widgetSandboxOrigin({CREEZIO_WIDGET_SANDBOX_ORIGIN:'https://proxy.invalid'},'sites',origin),'https://proxy.invalid');
  assert.equal(widgetSandboxOrigin({CREEZIO_WIDGET_SANDBOX_ORIGIN:'http://127.0.0.1:8794'},'local','http://127.0.0.1:8793'),'http://127.0.0.1:8794');
});

test('static sandbox publishes only compiled profiles and never business data', async () => {
  const catalog={resources:[{cspProfileId:digest,text:'PRIVATE-HTML-NOT-PUBLISHED-TO-PROXY',uiMeta:{
    csp:{connectDomains:[],resourceDomains:[],frameDomains:[],baseUriDomains:[]},permissions:{}}}]};
  const compiled=compileWidgetSandbox({catalog,hostOrigins:[origin]});
  assert.equal(compiled.script.includes('PRIVATE-HTML-NOT-PUBLISHED-TO-PROXY'),false);
  const worker=new Miniflare({host:'127.0.0.1',port:0,cf:false,modules:true,script:compiled.script,compatibilityDate:'2026-05-15'});
  try {
    const response=await worker.dispatchFetch(`https://proxy.invalid/profiles/${digest}/sandbox.html`);
    assert.equal(response.status,200);
    assert.match(response.headers.get('content-security-policy'),new RegExp(`frame-ancestors ${origin.replaceAll('.','\\.')}`));
    assert.equal(response.headers.get('set-cookie'),null);
    assert.equal(response.headers.get('cache-control'),'no-cache');
    assert.equal((await worker.dispatchFetch('https://proxy.invalid/api/health')).status,404);
    assert.equal((await worker.dispatchFetch(`https://proxy.invalid/profiles/${digest}/sandbox.html`,{method:'POST'})).status,405);
    assert.equal((await worker.dispatchFetch(`https://proxy.invalid/profiles/${digest}/sandbox.html`,{method:'HEAD'})).body,null);
  } finally {await worker.dispose();}
});

test('native widget projection and HTML recheck audience, context, permission and revoked session in real D1', {timeout:60000}, async () => {
  const bundled=await build({entryPoints:[new URL('http-worker.mjs',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1')],
    bundle:true,write:false,platform:'browser',format:'esm',target:'es2022',logLevel:'silent'});
  const worker=new Miniflare({host:'127.0.0.1',port:0,cf:false,modules:true,script:bundled.outputFiles[0].text,
    compatibilityDate:'2026-05-15',d1Databases:{DB:'creezio-widget-http-synthetic'}});
  try {
    const db=await worker.getD1Database('DB');
    const models=JSON.parse(readFileSync(new URL('extensions/native/access/module/models.json',root),'utf8'));
    await db.batch(generateD1Schema('creezio.access',models).statements.map(sql=>db.prepare(sql)));
    const call=async(method,...args)=>{
      const response=await worker.dispatchFetch(`${origin}/fixture`,{method:'POST',body:JSON.stringify({method,args})});
      const body=await response.json();assert.equal(response.status,200,body.error);return body.value;
    };
    const loginIdentifier='widget-projection@example.invalid',password='Synthetic widget projection password';
    const created=await call('bootstrap',{loginIdentifier,password,displayName:'Synthetic widget owner'});assert.equal(created.ok,true);
    const admin=await call('login',{loginIdentifier,password,audience:'admin'});
    const app=await call('login',{loginIdentifier,password,audience:'app'});
    assert.equal((await call('grant',admin.token,created.principalId)).ok,true);
    const headers={cookie:`__Host-creezio-app=${app.token}`,'x-creezio-context':'workspace-a'};
    const path='/api/widgets/app/catalog',resource=`/api/widgets/app/resource?uri=${encodeURIComponent(uri)}`;
    const read=(suffix,h=headers,method='GET')=>worker.dispatchFetch(`${origin}${suffix}`,{method,headers:h});
    const projection=await (await read(path)).json();assert.equal(projection.widgets.length,1);
    assert.equal(projection.sessionId,app.session.id);assert.equal(projection.resources[0].text,undefined);
    assert.equal((await (await read(resource)).json()).resource.text,'<!doctype html><p>Authorized card</p>');
    assert.equal((await read(path,{...headers,authorization:'Bearer broken'})).status,401);
    assert.equal((await read(path,{...headers,origin:'https://foreign.invalid'})).status,403);
    assert.equal((await read('/api/widgets/admin/catalog',headers)).status,401);
    assert.equal((await read(path,{...headers,'x-creezio-context':'outside'})).status,403);
    assert.equal((await read(`${resource}&uri=other`)).status,400);
    assert.equal((await read(path,headers,'HEAD')).body,null);
    assert.equal((await call('deny',admin.token,created.principalId)).ok,true);
    assert.equal((await (await read(path)).json()).widgets.length,0);
    assert.equal((await read(resource)).status,404);
    await call('revoke',app.session.id);
    assert.equal((await read(path)).status,401);
    assert.equal((await read(resource)).status,401);
  } finally {await worker.dispose();}
});
