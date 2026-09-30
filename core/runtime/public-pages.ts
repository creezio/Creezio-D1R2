import type {RuntimeDataCatalog} from '../data/types.ts';
import type {RuntimeEnvironment} from './environment.ts';
import {activeStorageCompositionCondition} from '../storage-authority/target.ts';

const mediaPath='/api/public/pages-navigation/media';
const slugPattern=/^\/[A-Za-z0-9/_-]{0,159}$/u;
const filePattern=/^f1_[a-f0-9]{64}$/u;
const tablePattern=/^cz_[a-f0-9]+_[a-f0-9]+$/u;
const imageTypes=new Set(['image/jpeg','image/png','image/webp']);
const maxImageBytes=10*1024*1024;
type Row=Record<string,unknown>;
type Tables=Readonly<Record<'page'|'page_publication'|'public_page'|'navigation'|'published_page_media'|'file_metadata',string>>;
type PublishedPage={id:string;slug:string;title:string;sections:unknown[];settings:Record<string,unknown>;
  seo:Record<string,unknown>;publishedRevision:number;publishedAt:string};
type NavItem={id:string;label:string;href:string;order:number;hidden:boolean;pageSlug?:string};
export type PublicPageProjection=Readonly<{moduleId:string;css:string;
  models:Readonly<Record<keyof Tables,string>>;
  render:(page:PublishedPage,navigation:readonly NavItem[],origin:string,css:string)=>string;
  imageIds:(page:PublishedPage)=>readonly string[]}>;

function tablesFor(catalog:RuntimeDataCatalog,projection:PublicPageProjection):Tables|null{
  const module=catalog.modules.find(part=>part.moduleId===projection.moduleId&&part.enabled);
  if(!module)return null;
  const ids=['page','page_publication','public_page','navigation','published_page_media','file_metadata'] as const;
  const result={} as Record<(typeof ids)[number],string>;
  for(const id of ids){const model=module.models.find(part=>part.modelId===projection.models[id]);
    if(!model||!tablePattern.test(model.table))return null;result[id]=model.table;}
  return Object.freeze(result);
}
function jsonValue(value:unknown,max:number):unknown{
  if(typeof value!=='string'||value.length>max)throw new Error('invalid_snapshot');
  return JSON.parse(value);
}
function headers(requestId:string,contentType:string):Headers{
  return new Headers({'content-type':contentType,'cache-control':'no-store','x-content-type-options':'nosniff',
    'x-creezio-request-id':requestId,'referrer-policy':'strict-origin-when-cross-origin'});
}
function unavailable(requestId:string):Response{return new Response('Service unavailable',{status:503,
  headers:headers(requestId,'text/plain; charset=utf-8')});}
function missing(requestId:string):Response{return new Response('Not found',{status:404,
  headers:headers(requestId,'text/plain; charset=utf-8')});}
function badRequest(requestId:string):Response{return new Response('Invalid request',{status:400,
  headers:headers(requestId,'text/plain; charset=utf-8')});}
function parsePage(row:Row):PublishedPage{
  const sections=jsonValue(row.published_sections,28_000);
  const settings=jsonValue(row.published_settings,4_000);
  const seo=jsonValue(row.published_seo,2_000);
  if(!Array.isArray(sections)||sections.length>30||!settings||typeof settings!=='object'||Array.isArray(settings)
    ||!seo||typeof seo!=='object'||Array.isArray(seo)||typeof row.id!=='string'||typeof row.published_slug!=='string'
    ||!slugPattern.test(row.published_slug)||typeof row.published_title!=='string'||row.published_title.length>240
    ||typeof row.published_at!=='string'||!Number.isSafeInteger(row.published_revision))throw new Error('invalid_snapshot');
  return {id:row.id,slug:row.published_slug,title:row.published_title,sections,settings,seo,
    publishedRevision:row.published_revision as number,publishedAt:row.published_at} as PublishedPage;
}
function originFor(request:Request,rawEnvironment:unknown):string|null{
  const raw=(rawEnvironment as Record<string,unknown>)?.CREEZIO_APP_ORIGIN;
  if(typeof raw!=='string')return null;
  try{const expected=new URL(raw),actual=new URL(request.url);
    return expected.href===`${expected.origin}/`&&expected.origin===actual.origin&&
      ['https:','http:'].includes(expected.protocol)?expected.origin:null;
  }catch{return null;}
}
function queryShape(url:URL,names:readonly string[]):boolean{
  if([...url.searchParams].length>names.length)return false;
  return [...url.searchParams.keys()].every(name=>names.includes(name)&&url.searchParams.getAll(name).length===1);
}

/** Fixed host context and exact publication joins are the only anonymous D1/R2 capability. */
export function createPublicPages(options:{catalog:RuntimeDataCatalog;contextId:string;projection:PublicPageProjection}){
  const tables=tablesFor(options.catalog,options.projection);
  const contextId=options.contextId;
  return Object.freeze({async dispatch(request:Request,resolved:RuntimeEnvironment,rawEnvironment:unknown,
    requestId:string,path:string):Promise<Response>{
    if(path!=='/p'&&path!==mediaPath)return missing(requestId);
    if(!tables||!contextId||contextId.length>128)return unavailable(requestId);
    if(request.method!=='GET'&&request.method!=='HEAD')return new Response('Method not allowed',{status:405,
      headers:new Headers({...Object.fromEntries(headers(requestId,'text/plain; charset=utf-8')),'allow':'GET, HEAD'})});
    const url=new URL(request.url),origin=originFor(request,rawEnvironment);
    if(!origin)return unavailable(requestId);
    const media=path===mediaPath,names=media?['slug','file_id','revision']:['slug'];
    if(!queryShape(url,names))return badRequest(requestId);
    const slug=url.searchParams.get('slug')??'/';
    if(!slugPattern.test(slug))return badRequest(requestId);
    try{
      // Public access is fixed to the deployment's front context, never a client-selected tenant.
      const selected=resolved.storageAuthority?.forContext(contextId);
      if(resolved.storage&&!resolved.storageAuthority)return unavailable(requestId);
      const db=selected?.db??resolved.bindings.DB;
      const routeCondition=selected?.storageRoute
        ?activeStorageCompositionCondition(selected.storageRoute,options.catalog.compositionDigest,options.catalog.lockDigest??'')
        :{sql:'1',bindings:[]};
      if(!media){
        const row=await db.prepare(`SELECT p.id,p.published_slug,p.published_title,p.published_sections,
          p.published_settings,p.published_seo,p.published_at,p.published_revision
          FROM ${tables.page} p JOIN ${tables.page_publication} pub
          ON pub.context_id=p.context_id AND pub.page_id=p.id
          JOIN ${tables.public_page} visible ON visible.context_id=p.context_id AND visible.page_id=p.id
          WHERE p.context_id=? AND p.published_slug=? AND p.published_at IS NOT NULL
          AND pub.state='published' AND pub.published_revision=p.published_revision
          AND visible.published_revision=p.published_revision AND (${routeCondition.sql}) LIMIT 2`)
          .bind(contextId,slug,...routeCondition.bindings).all<Row>();
        if(row.results.length!==1)return missing(requestId);
        const page=parsePage(row.results[0]);
        const nav=await db.prepare(`SELECT published_items FROM ${tables.navigation}
          WHERE context_id=? AND id='primary' AND published_at IS NOT NULL LIMIT 1`).bind(contextId).first<Row>();
        let navigation:NavItem[]=[];
        if(nav){const items=jsonValue(nav.published_items,28_000);
          if(!Array.isArray(items)||items.length>100)throw new Error('invalid_navigation');
          navigation=items as NavItem[];}
        if(navigation.some(item=>item.pageSlug)){
          const slugs=new Set<unknown>();
          const linked=[...new Set(navigation.map(item=>item.pageSlug).filter((slug):slug is string=>typeof slug==='string'))];
          for(let start=0;start<linked.length;start+=50){const chunk=linked.slice(start,start+50);
            const visible=await db.prepare(`SELECT p.published_slug FROM ${tables.page} p
            JOIN ${tables.page_publication} pub ON pub.context_id=p.context_id AND pub.page_id=p.id
            JOIN ${tables.public_page} mark ON mark.context_id=p.context_id AND mark.page_id=p.id
            WHERE p.context_id=? AND p.published_at IS NOT NULL AND pub.state='published'
            AND pub.published_revision=p.published_revision AND mark.published_revision=p.published_revision
            AND p.published_slug IN (${chunk.map(()=>'?').join(',')})
            LIMIT 50`).bind(contextId,...chunk).all<Row>();
            for(const item of visible.results)slugs.add(item.published_slug);
          }
          navigation=navigation.filter(item=>!item.pageSlug||slugs.has(item.pageSlug));
        }
        const stillVisible=await db.prepare(`SELECT 1 AS ok FROM ${tables.page} p
          JOIN ${tables.page_publication} pub ON pub.context_id=p.context_id AND pub.page_id=p.id
          JOIN ${tables.public_page} visible ON visible.context_id=p.context_id AND visible.page_id=p.id
          WHERE p.context_id=? AND p.id=? AND p.published_slug=? AND p.published_revision=?
          AND p.published_at IS NOT NULL AND pub.state='published'
          AND pub.published_revision=p.published_revision AND visible.published_revision=p.published_revision
          AND (${routeCondition.sql}) LIMIT 1`)
          .bind(contextId,page.id,page.slug,page.publishedRevision,...routeCondition.bindings).first<Row>();
        if(!stillVisible)return missing(requestId);
        const body='<!doctype html>'+options.projection.render(page,navigation,origin,options.projection.css);
        const responseHeaders=headers(requestId,'text/html; charset=utf-8');
        responseHeaders.set('content-security-policy',"default-src 'none'; img-src 'self' https:; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
        return new Response(request.method==='HEAD'?null:body,{status:200,headers:responseHeaders});
      }
      const fileId=url.searchParams.get('file_id'),revision=Number(url.searchParams.get('revision'));
      if(!fileId||!filePattern.test(fileId)||!Number.isSafeInteger(revision)||revision<1)return badRequest(requestId);
      const row=await db.prepare(`SELECT p.published_sections,p.published_settings,m.content_type,m.byte_size,
        m.digest,m.intent_id,m.generation,f.object_key,f.state AS file_state,f.version,
        f.digest AS file_digest,f.byte_size AS file_byte_size,f.content_type AS file_content_type,
        f.intent_id AS file_intent_id,f.generation AS file_generation
        FROM ${tables.page} p JOIN ${tables.page_publication} pub
        ON pub.context_id=p.context_id AND pub.page_id=p.id
        JOIN ${tables.public_page} visible ON visible.context_id=p.context_id AND visible.page_id=p.id
        JOIN ${tables.published_page_media} m ON m.context_id=p.context_id AND m.page_id=p.id
        JOIN ${tables.file_metadata} f ON f.context_id=p.context_id AND f.file_id=m.file_id
        WHERE p.context_id=? AND p.published_slug=? AND p.published_at IS NOT NULL
        AND pub.state='published' AND pub.published_revision=p.published_revision
        AND visible.published_revision=p.published_revision AND p.published_revision=?
        AND m.file_id=? AND (${routeCondition.sql}) LIMIT 1`)
        .bind(contextId,slug,revision,fileId,...routeCondition.bindings).first<Row>();
      if(!row||row.file_state!=='available'||row.object_key!==`creezio/files/v1/${fileId}`
        ||!imageTypes.has(String(row.content_type))||row.content_type!==row.file_content_type
        ||!Number.isSafeInteger(row.byte_size)||Number(row.byte_size)>maxImageBytes||Number(row.byte_size)<1
        ||row.byte_size!==row.file_byte_size||row.digest!==row.file_digest||row.intent_id!==row.file_intent_id
        ||row.generation!==row.file_generation||typeof row.digest!=='string'||!/^[a-f0-9]{64}$/u.test(row.digest))
        return missing(requestId);
      const sections=jsonValue(row.published_sections,28_000),settings=jsonValue(row.published_settings,4_000);
      if(!Array.isArray(sections)||!settings||typeof settings!=='object'||Array.isArray(settings)
        ||!options.projection.imageIds({sections,settings} as PublishedPage).includes(fileId))return missing(requestId);
      const bucket=(selected?.bucket??resolved.bindings.BUCKET) as unknown as {get(key:string):Promise<{size:number;arrayBuffer():Promise<ArrayBuffer>}|null>};
      const object=await bucket.get(String(row.object_key));
      if(!object||object.size!==row.byte_size)return missing(requestId);
      const bytes=await object.arrayBuffer();
      if(bytes.byteLength!==row.byte_size)return missing(requestId);
      const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(part=>part.toString(16).padStart(2,'0')).join('');
      if(digest!==row.digest)return missing(requestId);
      const stillVisible=await db.prepare(`SELECT 1 AS ok FROM ${tables.page} p
        JOIN ${tables.page_publication} pub ON pub.context_id=p.context_id AND pub.page_id=p.id
        JOIN ${tables.public_page} visible ON visible.context_id=p.context_id AND visible.page_id=p.id
        JOIN ${tables.published_page_media} m ON m.context_id=p.context_id AND m.page_id=p.id
        JOIN ${tables.file_metadata} f ON f.context_id=p.context_id AND f.file_id=m.file_id
        WHERE p.context_id=? AND p.published_slug=? AND p.published_at IS NOT NULL
        AND pub.state='published' AND pub.published_revision=p.published_revision
        AND visible.published_revision=p.published_revision AND p.published_revision=? AND m.file_id=?
        AND m.digest=? AND m.byte_size=? AND m.content_type=?
        AND f.state='available' AND f.object_key=? AND f.digest=m.digest AND f.byte_size=m.byte_size
        AND f.content_type=m.content_type AND f.intent_id=m.intent_id AND f.generation=m.generation
        AND (${routeCondition.sql}) LIMIT 1`)
        .bind(contextId,slug,revision,fileId,digest,bytes.byteLength,row.content_type,row.object_key,...routeCondition.bindings).first<Row>();
      if(!stillVisible)return missing(requestId);
      const responseHeaders=headers(requestId,String(row.content_type));
      responseHeaders.set('content-length',String(bytes.byteLength));
      return new Response(request.method==='HEAD'?null:bytes,{status:200,headers:responseHeaders});
    }catch{return unavailable(requestId);}
  }});
}
