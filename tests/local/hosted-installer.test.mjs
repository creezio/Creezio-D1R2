import '../../scripts/local-environment.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Miniflare} from 'miniflare';
import {describeD1Schema} from '../../scripts/data/d1-schema.mjs';
import {schemaDigest} from '../../scripts/data/composition-schema.mjs';
import {createHostedInstallOperator} from '../../adapters/sites/operator.ts';
import {createAccountService,provisionBootstrapCapability} from '../../core/identity/accounts.ts';
import {ACCESS_TABLES} from '../../core/identity/d1-store.ts';

const schema=describeD1Schema('creezio.access',JSON.parse(readFileSync(new URL('../../extensions/native/access/module/models.json',import.meta.url),'utf8')));
const password='Synthetic hosted operator qualification password';
const token='A'.repeat(43),origin='https://qualification.example.invalid';
async function fixture() {
  const runtime=new Miniflare({host:'127.0.0.1',port:0,cf:false,modules:true,compatibilityDate:'2026-05-15',
    script:'export default {fetch(){return new Response(null,{status:404})}}',d1Databases:{DB:'operator-test'},d1Persist:false});
  try {
    const db=await runtime.getD1Database('DB');
    await db.batch(schema.objects.map(o=>db.prepare(o.sql)));
    const plan={schemaVersion:1,applicationId:'creezio',digest:schemaDigest(schema.objects),
      objects:schema.objects.map(o=>({...o,sql:o.sql.trim().replace(/;$/,'')})),providerObjects:[{
        type:'table',name:'_cf_METADATA',table:'_cf_METADATA',
        sql:'CREATE TABLE _cf_METADATA (\n        key INTEGER PRIMARY KEY,\n        value BLOB\n      )',
      }]};
    const operator=createHostedInstallOperator(plan),env={DB:db,CREEZIO_INSTALL_TOKEN:token,
      CREEZIO_INSTALL_EXPIRES_AT:String(Date.now()+600_000),CREEZIO_APP_ORIGIN:origin};
    const request=(body,authorization=`Bearer ${token}`)=>new Request(origin+'/__creezio/operator',{method:'POST',
      headers:{'content-type':'application/json',authorization},body:JSON.stringify({planDigest:plan.digest,...body})});
    const bootstrap={action:'bootstrap',loginIdentifier:'operator@example.invalid',displayName:'Operator',password};
    return {runtime,db,plan,operator,env,request,bootstrap};
  } catch(error){await runtime.dispose();throw error;}
}

test('separate operator requires exact origin, deployment secret, expiry and schema before writes',async()=>{
  const f=await fixture();try {
    assert.equal((await f.operator.fetch(f.request({action:'inspect'},`Bearer ${'B'.repeat(43)}`),f.env)).status,401);
    assert.equal((await f.operator.fetch(f.request({action:'inspect'}),{...f.env,CREEZIO_INSTALL_EXPIRES_AT:String(Date.now()-1)})).status,503);
    assert.equal((await f.operator.fetch(new Request(origin+'/api/access/admin/bootstrap'),f.env)).status,404);
    assert.equal((await f.operator.fetch(f.request({action:'inspect',planDigest:'sha256-'+'0'.repeat(64)}),f.env)).status,400);
    assert.equal((await f.operator.fetch(f.request({action:'inspect',sql:'DELETE FROM users'}),f.env)).status,400);
    const result=await f.operator.fetch(f.request({action:'inspect'}),f.env);assert.equal(result.status,200,await result.clone().text());
    assert.equal((await result.json()).state,'ready');
    assert.equal((await f.db.prepare(`SELECT COUNT(*) AS n FROM "${ACCESS_TABLES.principals}"`).first()).n,0);
    await f.db.prepare('CREATE TABLE unexpected (id TEXT)').run();
    assert.equal((await f.operator.fetch(f.request(f.bootstrap),f.env)).status,409);
    assert.equal((await f.db.prepare(`SELECT COUNT(*) AS n FROM "${ACCESS_TABLES.principals}"`).first()).n,0);
  }finally{await f.runtime.dispose();}
});

test('native bootstrap survives replacement by app account service; repeated install never replaces the account',async()=>{
  const f=await fixture();try {
    const installed=await f.operator.fetch(f.request(f.bootstrap),f.env);
    assert.equal(installed.status,200,await installed.clone().text());const result=await installed.json();assert.equal(result.state,'installed');
    assert.equal(JSON.stringify(result).includes(password),false);assert.equal(JSON.stringify(result).includes(token),false);
    const accounts=createAccountService(f.db);
    assert.equal((await accounts.login({loginIdentifier:f.bootstrap.loginIdentifier,password,audience:'admin'})).ok,true);
    const second=await f.operator.fetch(f.request({...f.bootstrap,loginIdentifier:'intruder@example.invalid',password:'Replacement password must never work'}),f.env);
    assert.equal(second.status,200);assert.deepEqual(await second.json(),result);
    assert.equal((await f.db.prepare(`SELECT COUNT(*) AS n FROM "${ACCESS_TABLES.principals}"`).first()).n,1);
    assert.equal((await accounts.login({loginIdentifier:'intruder@example.invalid',password:'Replacement password must never work',audience:'admin'})).ok,false);
  }finally{await f.runtime.dispose();}
});

test('a lost successful operator reply is inspected without another bootstrap',async()=>{
  const f=await fixture();try {
    await f.operator.fetch(f.request(f.bootstrap),f.env); // Deliberately discard the acknowledged body.
    const inspection=await f.operator.fetch(f.request({action:'inspect'}),f.env);
    assert.equal((await inspection.json()).state,'installed');
    // Principal and consumed marker are authoritative regardless of provider transport receipt.
    assert.equal((await f.db.prepare(`SELECT COUNT(*) AS n FROM "${ACCESS_TABLES.principals}"`).first()).n,1);
    const marker=await f.db.prepare(`SELECT principal_id,claim_nonce FROM "${ACCESS_TABLES.bootstrap}" WHERE id='installation'`).first();
    assert.ok(marker.principal_id);assert.ok(marker.claim_nonce);
  }finally{await f.runtime.dispose();}
});

test('an unconsumed pending capability is reported and cannot be rearmed early',async()=>{
  const f=await fixture();try {
    const pending=await provisionBootstrapCapability(f.db);assert.ok(pending);
    const inspection=await f.operator.fetch(f.request({action:'inspect'}),f.env);
    assert.equal(inspection.status,200);
    const state=await inspection.json();
    assert.equal(state.state,'capability_pending');
    assert.equal(state.expiresAtMs,pending.expiresAtMs);
    const retry=await f.operator.fetch(f.request(f.bootstrap),f.env);
    assert.equal(retry.status,409);
    assert.equal((await retry.json()).error,'bootstrap_unavailable');
    assert.equal((await f.db.prepare(`SELECT COUNT(*) AS n FROM "${ACCESS_TABLES.principals}"`).first()).n,0);
  }finally{await f.runtime.dispose();}
});

test('provider automatic indexes are explicitly bound to their table and null SQL definition',async()=>{
  const f=await fixture();try {
    await f.db.prepare('CREATE TABLE __appgarden_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT UNIQUE,applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)').run();
    const objects=(await f.db.prepare('SELECT type,name,tbl_name AS "table",sql FROM sqlite_schema ORDER BY type,name').all()).results;
    const providerObjects=objects.filter(o=>!f.plan.objects.some(expected=>expected.name===o.name));
    assert.ok(providerObjects.some(o=>o.type==='index'&&o.sql===null));
    const operator=createHostedInstallOperator({...f.plan,providerObjects});
    assert.equal((await operator.fetch(f.request({action:'inspect'}),f.env)).status,200);
    assert.equal((await operator.fetch(f.request(f.bootstrap),f.env)).status,200);
    const changed=createHostedInstallOperator({...f.plan,providerObjects:providerObjects.map(o=>o.sql===null?{...o,table:'another_table'}:o)});
    assert.equal((await changed.fetch(f.request({action:'inspect'}),f.env)).status,409);
    assert.throws(()=>createHostedInstallOperator({...f.plan,objects:[...f.plan.objects,{type:'index',name:'sqlite_autoindex_product_1',table:'product',sql:null}]}));
  }finally{await f.runtime.dispose();}
});
