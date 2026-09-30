import test from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare,Log,LogLevel} from 'miniflare';
import {describeD1Schema} from '../../scripts/data/d1-schema.mjs';
import {dispatchFileHttp} from '../../core/files/http.ts';
import {ACCESS_TABLES} from '../../core/identity/d1-store.ts';
import {STORAGE_AUTHORITY_MODULE_ID,STORAGE_AUTHORITY_MODELS,STORAGE_AUTHORITY_TABLES}
  from '../../core/storage-authority/models.ts';
import {createStorageFixture,moduleId,catalog as baseCatalog,category,permissions,schema,table}
  from '../data/fixtures/storage.mjs';
import {appendStorageCompositionReceipt} from './fixtures/schema-receipt.mjs';

const origin='http://127.0.0.1:8787';
const catalog={...baseCatalog,lockDigest:`sha256-${'7'.repeat(64)}`};
const authoritySchema=describeD1Schema(STORAGE_AUTHORITY_MODULE_ID,STORAGE_AUTHORITY_MODELS);
const fileCatalog={compositionDigest:catalog.compositionDigest,categories:[{moduleId,category,audiences:['admin','app']}]};

test('file HTTP uses the selected target D1/R2 while admission and identity stay on the primary D1',
  {timeout:60000},async()=>{
    const fixture=await createStorageFixture();
    const runtime=new Miniflare({host:'127.0.0.1',port:0,cf:false,modules:true,
      script:'export default {fetch(){return new Response(null,{status:404})}}',
      compatibilityDate:'2026-05-15',d1Databases:{TARGET:'creezio-t33-file-target'},
      r2Buckets:['TARGET_BUCKET'],d1Persist:false,r2Persist:false,
      telemetry:{enabled:false},logRequests:false,log:new Log(LogLevel.NONE)});
    try{
      const db=await runtime.getD1Database('TARGET'),bucket=await runtime.getR2Bucket('TARGET_BUCKET');
      await db.batch([...schema.statements,...authoritySchema.statements].map(sql=>db.prepare(sql)));
      await appendStorageCompositionReceipt(db,catalog.compositionDigest,catalog.lockDigest);
      const epoch=(await fixture.db.prepare(`SELECT epoch FROM "${ACCESS_TABLES.authorization_state}"
        WHERE id='application'`).first()).epoch;
      const identity={installationId:'t33-file-installation',contextId:'other',slot:1};
      await db.prepare(`INSERT INTO "${STORAGE_AUTHORITY_TABLES.storage_routes}"
        (id,installation_id,slot,generation,state,mutation_id,source_epoch,updated_at_ms)
        VALUES (?,?,?,1,'active',NULL,?,0)`)
        .bind(identity.contextId,identity.installationId,identity.slot,epoch).run();
      const storageAuthority={forContext(contextId){
        if(contextId!=='other')throw new Error('Unknown routed context.');
        return {db,bucket,authorityDb:fixture.db,storageRoute:identity};
      }};
      const environment={profile:'local',bindings:{DB:fixture.db,BUCKET:fixture.bucket},
        storage:{resolve(){throw new Error('Not used by file helper.');}},storageAuthority};
      const request=intent=>new Request(`${origin}/api/files/admin/${moduleId}/${category.id}`,{
        method:'PUT',headers:{cookie:`creezio-local-admin=${fixture.signed.token}`,
          'x-creezio-context':'other',origin,'x-creezio-request':'1',
          'x-creezio-file-intent':intent,'x-creezio-file-generation':'1',
          'x-creezio-file-name':'proof.txt','content-type':'text/plain'},body:'routed file proof'});
      const options={catalog,files:fileCatalog,permissions,storageAuthority};
      const missing=await dispatchFileHttp(request('missing-option'),environment,
        {CREEZIO_APP_ORIGIN:origin},'missing-option',{catalog,files:fileCatalog,permissions});
      assert.equal(missing.status,503);
      const staged=await dispatchFileHttp(request('routed-stage'),environment,
        {CREEZIO_APP_ORIGIN:origin},'routed-stage',options);
      assert.equal(staged.status,201,await staged.clone().text());
      const reference=(await staged.json()).reference;
      assert.match(reference.fileId,/^f1_[0-9a-f]{64}$/);
      assert.equal((await fixture.db.prepare(`SELECT COUNT(*) AS count FROM ${table('file_metadata')}`).first()).count,0);
      const target=await db.prepare(`SELECT object_key AS key FROM ${table('file_metadata')}`).first();
      assert.ok(target?.key);
      assert.ok(await bucket.head(target.key));
      assert.equal(await fixture.bucket.head(target.key),null);
      await db.prepare(`UPDATE "${STORAGE_AUTHORITY_TABLES.storage_routes}" SET state='deny'
        WHERE id='other'`).run();
      const denied=await dispatchFileHttp(request('fenced-stage'),environment,
        {CREEZIO_APP_ORIGIN:origin},'fenced-stage',options);
      assert.equal(denied.status,503);
      assert.equal((await db.prepare(`SELECT COUNT(*) AS count FROM ${table('file_metadata')}`).first()).count,1);
    }finally{await runtime.dispose();await fixture.dispose();}
  });
