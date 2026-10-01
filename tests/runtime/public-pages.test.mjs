import '../../scripts/local-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {pathToFileURL} from 'node:url';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Miniflare} from 'miniflare';
import {build} from 'esbuild';
import {generateD1Schema} from '../../scripts/data/d1-schema.mjs';
import {createRuntime} from '../../core/runtime/dispatch.ts';
import {createPublicPages} from '../../core/runtime/public-pages.ts';
import {publishedImageIds} from '../../extensions/native/pages-navigation/ui/published-images.ts';
import {STORAGE_AUTHORITY_MODELS,STORAGE_AUTHORITY_MODULE_ID,STORAGE_AUTHORITY_TABLES}
  from '../../core/storage-authority/models.ts';
import {appendStorageCompositionReceipt} from '../storage-authority/fixtures/schema-receipt.mjs';

const bundle=await build({entryPoints:[fileURLToPath(new URL('../../extensions/native/pages-navigation/ui/public-document.tsx',import.meta.url))],
  bundle:true,write:false,platform:'node',format:'esm',jsx:'automatic',
  banner:{js:"import {createRequire} from 'node:module';const require=createRequire(import.meta.url);"}});
const bundleDir=await mkdtemp(join(tmpdir(),'creezio-public-pages-'));
let renderPublicPage;
try{const bundlePath=join(bundleDir,'public-pages.mjs');
  await writeFile(bundlePath,bundle.outputFiles[0].contents);
  ({renderPublicPage}=await import(pathToFileURL(bundlePath).href));
}finally{await rm(bundleDir,{recursive:true,force:true});}

const models=JSON.parse(readFileSync(new URL('../../extensions/native/pages-navigation/module/models.json',import.meta.url)));
const schema=generateD1Schema('creezio.pages-navigation',models);
const digest='sha256-'+'8'.repeat(64);
const catalog={schemaVersion:1,compositionDigest:digest,lockDigest:`sha256-${'7'.repeat(64)}`,modules:[{moduleId:'creezio.pages-navigation',
  version:'0.0.0',enabled:true,permissions:[],models:models.map(model=>({modelId:model.id,
    table:schema.tables[model.id],model}))}]};
const origin='https://pages.example.invalid',at='2026-09-30T10:00:00.000Z';
const fileId='f1_'+'a'.repeat(64),key=`creezio/files/v1/${fileId}`;
const sections=[{id:'hero',kind:'hero',position:0,enabled:true,content:{title:'Published headline',imageFileId:fileId}}];
const settings={brandName:'Creezio'};
const seo={title:'Indexable title',description:'Published description'};
const request=(path,options)=>new Request(`${origin}${path}`,options);
test('public SSR canonical follows safe published URLs and escapes the HTML attribute',()=>{
  const rendered=canonical=>renderPublicPage({slug:'/',title:'Public page',sections:[],settings:{},
    seo:{canonical},publishedRevision:1},[],origin,'');
  const href=canonical=>rendered(canonical).match(/<link rel="canonical" href="([^"]+)"/)?.[1];
  const ownUrl='https://pages.example.invalid/p?slug=%2F';
  assert.equal(href('https://example.com/qualification-creezio'),
    'https://example.com/qualification-creezio');
  assert.equal(href('http://example.com/qualification-creezio'),
    'http://example.com/qualification-creezio');
  assert.equal(href('/qualification-creezio'),
    'https://pages.example.invalid/qualification-creezio');
  assert.equal(href('https://example.com/?a=1&b=2'),
    'https://example.com/?a=1&amp;b=2');
  for(const unsafe of ['javascript:alert(1)','https://user:pass@example.com/',
    '//example.com/qualification-creezio',''])assert.equal(href(unsafe),ownUrl,unsafe);
});
async function insert(db,model,values){const fields=Object.keys(values);
  await db.prepare(`INSERT INTO "${schema.tables[model]}" (${fields.map(field=>`"${field}"`).join(',')}) VALUES (${fields.map(()=>'?').join(',')})`)
    .bind(...Object.values(values)).run();}

test('anonymous SSR and exact published media are gated by the explicit marker and revision',{timeout:30000},async()=>{
  const mf=new Miniflare({host:'127.0.0.1',port:0,cf:false,modules:true,compatibilityDate:'2026-05-15',
    script:'export default {fetch(){return new Response(null,{status:404})}}',
    d1Databases:{DB:'creezio-public-pages-test'},r2Buckets:['BUCKET'],d1Persist:false,r2Persist:false});
  try{
    const db=await mf.getD1Database('DB'),bucket=await mf.getR2Bucket('BUCKET');
    await db.batch(schema.statements.map(statement=>db.prepare(statement)));
    const css=readFileSync(new URL('../../extensions/native/pages-navigation/ui/landing.css',import.meta.url),'utf8');
    const runtime=createRuntime({modules:[],compositionDigest:digest,
      publicPages:createPublicPages({catalog,contextId:'application',projection:{moduleId:'creezio.pages-navigation',
        models:{page:'page',page_publication:'page_publication',public_page:'public_page',navigation:'navigation',
          published_page_media:'published_page_media',file_metadata:'file_metadata'},
        css,render:renderPublicPage,imageIds:publishedImageIds}})});
    const env={CREEZIO_RUNTIME_PROFILE:'local',CREEZIO_APP_ORIGIN:origin,DB:db,BUCKET:bucket};
    const fetch=(path,options)=>runtime.fetch(request(path,options),env);
    const home={context_id:'application',id:'home',slug:'/',title:'Draft secret',
      draft_sections:JSON.stringify([{...sections[0],content:{title:'Draft secret'}}]),
      draft_settings:JSON.stringify(settings),draft_seo:JSON.stringify({title:'Draft secret'}),
      published_slug:'/',published_title:'Published page',published_sections:JSON.stringify(sections),
      published_settings:JSON.stringify(settings),published_seo:JSON.stringify(seo),created_at:at,updated_at:at,
      published_at:at,revision:3,published_revision:1};
    await insert(db,'page',home);
    await insert(db,'page_publication',{context_id:'application',page_id:'home',state:'published',published_revision:1});
    const image=Buffer.from('public image bytes');
    const sha=createHash('sha256').update(image).digest('hex');
    await bucket.put(key,image);
    await insert(db,'file_metadata',{context_id:'application',file_id:fileId,file_owner:'owner',object_key:key,
      digest:sha,byte_size:image.byteLength,content_type:'image/png',filename:'image.png',version:1,
      state:'available',intent_id:'intent',generation:'1'});
    await insert(db,'published_page_media',{context_id:'application',page_id:'home',file_id:fileId,
      filename:'image.png',content_type:'image/png',byte_size:image.byteLength,digest:sha,
      intent_id:'intent',generation:'1',position:0});
    const media=`/api/public/pages-navigation/media?slug=%2F&file_id=${fileId}&revision=1`;
    assert.equal((await fetch('/p?slug=%2F')).status,404,'protected publication has no anonymous page');
    assert.equal((await fetch(media)).status,404,'linked media also remains private');
    await insert(db,'public_page',{context_id:'application',page_id:'home',published_revision:1,enabled_at:at});
    const page=await fetch('/p?slug=%2F');
    assert.equal(page.status,200,await page.clone().text());
    assert.match(page.headers.get('content-type'),/^text\/html/);
    assert.equal(page.headers.get('cache-control'),'no-store');
    const html=await page.text();
    assert.match(html,/<!doctype html><html/);
    assert.match(html,/<title>Indexable title<\/title>/);
    assert.match(html,/Published headline/);
    assert.match(html,/Published description/);
    assert.match(html,/<link rel="canonical" href="https:\/\/pages.example.invalid\/p\?slug=%2F"/);
    assert.doesNotMatch(html,/Draft secret/);
    assert.match(html,/\/api\/public\/pages-navigation\/media\?slug=/);
    const body=await fetch(media);
    assert.equal(body.status,200,await body.clone().text());
    assert.equal(body.headers.get('content-type'),'image/png');
    assert.equal(body.headers.get('cache-control'),'no-store');
    assert.deepEqual(Buffer.from(await body.arrayBuffer()),image);
    assert.equal((await fetch(media.replace('revision=1','revision=2'))).status,404);
    assert.equal((await fetch(`/api/public/pages-navigation/media?slug=%2F&file_id=${'f1_'+'b'.repeat(64)}&revision=1`)).status,404);
    assert.equal((await fetch('/p?slug=%2F',{method:'POST'})).status,405);
    assert.equal((await fetch('/p?slug=%2F',{headers:{cookie:'forged',authorization:'Bearer forged'},method:'HEAD'})).status,200);
    await insert(db,'navigation',{context_id:'application',id:'primary',draft_items:'[]',published_items:JSON.stringify([
      {id:'home',label:'Accueil',href:'/',pageSlug:'/',icon:'',group:'',order:0,hidden:false}]),
      revision:1,published_revision:1,updated_at:at,published_at:at});
    for(let index=0;index<101;index++){
      const id=`bulk-${index}`,slug=`/bulk-${index}`;
      await insert(db,'page',{...home,id,slug,published_slug:slug,published_title:id});
      await insert(db,'page_publication',{context_id:'application',page_id:id,state:'published',published_revision:1});
      await insert(db,'public_page',{context_id:'application',page_id:id,published_revision:1,enabled_at:at});
    }
    const linked=Array.from({length:100},(_,index)=>({id:`bulk-${index}`,label:`Page ${index}`,
      href:`/bulk-${index}`,pageSlug:`/bulk-${index}`,icon:'',group:'',order:index,hidden:false}));
    await db.prepare(`UPDATE "${schema.tables.navigation}" SET published_items=? WHERE context_id='application' AND id='primary'`)
      .bind(JSON.stringify(linked)).run();
    const largeCatalog=await fetch('/p?slug=%2F');
    assert.equal(largeCatalog.status,200,'navigation reads only its referenced public slugs');
    assert.match(await largeCatalog.text(),/Navigation éditoriale/);
    let releaseNav,enteredNav;
    const navEntered=new Promise(resolve=>{enteredNav=resolve;});
    const navWaiting=new Promise(resolve=>{releaseNav=resolve;});
    const delayedDb={prepare:sql=>{const statement=db.prepare(sql);
      if(!sql.includes('SELECT published_items'))return statement;
      return {bind:(...args)=>{const bound=statement.bind(...args);
        return {first:async()=>{enteredNav();await navWaiting;return bound.first();}};}};},
      batch:queries=>db.batch(queries)};
    const htmlRace=runtime.fetch(request('/p?slug=%2F'),{...env,DB:delayedDb});
    await navEntered;
    await db.prepare(`DELETE FROM "${schema.tables.public_page}" WHERE context_id='application' AND page_id='home'`).run();
    releaseNav();
    assert.equal((await htmlRace).status,404,'SSR rechecks the marker after waiting on navigation');
    await insert(db,'public_page',{context_id:'application',page_id:'home',published_revision:1,enabled_at:at});
    let releaseGet,enteredGet;
    const entered=new Promise(resolve=>{enteredGet=resolve;});
    const waiting=new Promise(resolve=>{releaseGet=resolve;});
    const delayedBucket={get:async objectKey=>{enteredGet();await waiting;return bucket.get(objectKey);},
      head:key=>bucket.head(key),put:(...args)=>bucket.put(...args),delete:key=>bucket.delete(key)};
    const racing=runtime.fetch(request(media),{...env,BUCKET:delayedBucket});
    await entered;
    await db.prepare(`DELETE FROM "${schema.tables.public_page}" WHERE context_id='application' AND page_id='home'`).run();
    releaseGet();
    assert.equal((await racing).status,404,'revocation during R2 read is rechecked before response');
    await insert(db,'public_page',{context_id:'application',page_id:'home',published_revision:1,enabled_at:at});
    let releaseSecond,enteredSecond;
    const secondEntered=new Promise(resolve=>{enteredSecond=resolve;});
    const secondWaiting=new Promise(resolve=>{releaseSecond=resolve;});
    const delayedAgain={...delayedBucket,get:async objectKey=>{enteredSecond();await secondWaiting;return bucket.get(objectKey);}};
    const fileRace=runtime.fetch(request(media),{...env,BUCKET:delayedAgain});
    await secondEntered;
    await db.prepare(`UPDATE "${schema.tables.file_metadata}" SET state='deleted'
      WHERE context_id='application' AND file_id=?`).bind(fileId).run();
    releaseSecond();
    assert.equal((await fileRace).status,404,'file metadata revocation during R2 read is rechecked');
    await db.prepare(`UPDATE "${schema.tables.file_metadata}" SET state='available'
      WHERE context_id='application' AND file_id=?`).bind(fileId).run();
    await db.prepare(`UPDATE "${schema.tables.public_page}" SET published_revision=2 WHERE context_id='application' AND page_id='home'`).run();
    assert.equal((await fetch('/p?slug=%2F')).status,404,'stale marker cannot expose a newer snapshot');
    assert.equal((await fetch(media)).status,404);
    await db.prepare(`DELETE FROM "${schema.tables.public_page}" WHERE context_id='application' AND page_id='home'`).run();
    assert.equal((await fetch('/p?slug=%2F')).status,404,'revocation is immediate');
  }finally{await mf.dispose();}
});

test('a fixed routed front reads its published page and image from the same D1/R2 pair',
  {timeout:30000},async()=>{
  const mf=new Miniflare({host:'127.0.0.1',port:0,cf:false,modules:true,compatibilityDate:'2026-05-15',
    script:'export default {fetch(){return new Response(null,{status:404})}}',
    d1Databases:{DB:'public-primary',TARGET:'public-target'},r2Buckets:['BUCKET','FILES'],
    d1Persist:false,r2Persist:false});
  try{
    const db=await mf.getD1Database('TARGET'),bucket=await mf.getR2Bucket('FILES');
    await db.batch(schema.statements.map(statement=>db.prepare(statement)));
    const authoritySchema=generateD1Schema(STORAGE_AUTHORITY_MODULE_ID,STORAGE_AUTHORITY_MODELS);
    await db.batch(authoritySchema.statements.map(statement=>db.prepare(statement)));
    await appendStorageCompositionReceipt(db,digest,catalog.lockDigest);
    const contextId='tenant-front',image=Buffer.from('routed published image');
    await db.prepare(`INSERT INTO "${STORAGE_AUTHORITY_TABLES.storage_routes}"
      (id,installation_id,slot,generation,source_epoch,state,mutation_id,updated_at_ms)
      VALUES (?,'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',1,1,1,'active',NULL,?)`)
      .bind(contextId,Date.now()).run();
    const sha=createHash('sha256').update(image).digest('hex');
    await insert(db,'page',{context_id:contextId,id:'home',slug:'/',title:'Private draft',
      draft_sections:'[]',draft_settings:'{}',draft_seo:'{}',published_slug:'/',
      published_title:'Routed public page',published_sections:JSON.stringify(sections),
      published_settings:JSON.stringify(settings),published_seo:JSON.stringify(seo),
      created_at:at,updated_at:at,published_at:at,revision:1,published_revision:1});
    await insert(db,'page_publication',{context_id:contextId,page_id:'home',state:'published',published_revision:1});
    await insert(db,'public_page',{context_id:contextId,page_id:'home',published_revision:1,enabled_at:at});
    await bucket.put(key,image);
    await insert(db,'file_metadata',{context_id:contextId,file_id:fileId,file_owner:'owner',object_key:key,
      digest:sha,byte_size:image.byteLength,content_type:'image/png',filename:'image.png',version:1,
      state:'available',intent_id:'intent',generation:'1'});
    await insert(db,'published_page_media',{context_id:contextId,page_id:'home',file_id:fileId,
      filename:'image.png',content_type:'image/png',byte_size:image.byteLength,digest:sha,
      intent_id:'intent',generation:'1',position:0});
    const runtime=createRuntime({modules:[],compositionDigest:digest,
      publicPages:createPublicPages({catalog,contextId,projection:{moduleId:'creezio.pages-navigation',
        models:{page:'page',page_publication:'page_publication',public_page:'public_page',navigation:'navigation',
          published_page_media:'published_page_media',file_metadata:'file_metadata'},
        css:'',render:renderPublicPage,imageIds:publishedImageIds}})});
    const manifest={schemaVersion:2,storageInstallationId:'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      routes:[{contextId,slot:1,status:'active'}]};
    // No page tables exist on the principal D1, and the principal R2 is empty.
    const env={CREEZIO_RUNTIME_PROFILE:'local',CREEZIO_APP_ORIGIN:origin,
      DB:await mf.getD1Database('DB'),BUCKET:await mf.getR2Bucket('BUCKET'),
      DB_RESOURCE_01:db,BUCKET_RESOURCE_01:bucket,CREEZIO_STORAGE_ROUTES:JSON.stringify(manifest)};
    const page=await runtime.fetch(request('/p?slug=%2F',{headers:{'x-creezio-context':'application'}}),env);
    assert.equal(page.status,200,await page.clone().text());
    assert.match(await page.text(),/Published headline/);
    const media=await runtime.fetch(request(`/api/public/pages-navigation/media?slug=%2F&file_id=${fileId}&revision=1`),env);
    assert.equal(media.status,200,await media.clone().text());
    assert.deepEqual(Buffer.from(await media.arrayBuffer()),image);
    assert.equal((await runtime.fetch(request('/p?slug=%2F&context=application'),env)).status,400);
    const changedBucket={get:async objectKey=>{
      await appendStorageCompositionReceipt(db,digest,'sha256-'+'9'.repeat(64));return bucket.get(objectKey);},
      head:objectKey=>bucket.head(objectKey),put:(...args)=>bucket.put(...args),delete:objectKey=>bucket.delete(objectKey)};
    const oldImage=await runtime.fetch(request(`/api/public/pages-navigation/media?slug=%2F&file_id=${fileId}&revision=1`),
      {...env,BUCKET_RESOURCE_01:changedBucket});
    assert.equal(oldImage.status,404,'a new composition during the R2 read suppresses the old response');
    assert.equal((await runtime.fetch(request('/p?slug=%2F'),env)).status,404,'old Worker cannot render after cutover');
    await appendStorageCompositionReceipt(db,digest,catalog.lockDigest);
    await db.prepare(`UPDATE "${STORAGE_AUTHORITY_TABLES.storage_routes}" SET state='deny' WHERE id=?`).bind(contextId).run();
    assert.equal((await runtime.fetch(request('/p?slug=%2F'),env)).status,404,'durable target fence suppresses anonymous reads');
    const revoked={...manifest,routes:[{...manifest.routes[0],status:'revoked'}]};
    assert.equal((await runtime.fetch(request('/p?slug=%2F'),{...env,CREEZIO_STORAGE_ROUTES:JSON.stringify(revoked)})).status,503);
  }finally{await mf.dispose();}
});
