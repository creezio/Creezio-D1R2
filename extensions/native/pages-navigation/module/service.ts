import {OperationError} from '@creezio/sdk/operations/error';
import type {OperationContext,JsonValue} from '@creezio/sdk/operations/handler';

type Row=Record<string,JsonValue>;
type Input=Record<string,any>;
type Page={items:readonly Row[];nextAfter:Row|null};
const arg=(v:JsonValue):Input=>v&&typeof v==='object'&&!Array.isArray(v)?v as Input:{};
const fail=(code:'invalid_input'|'not_found'|'conflict'|'unavailable'):never=>{throw new OperationError(code);};
const id=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&v.length<=128&&/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(v);
const line=(v:unknown,max:number):v is string=>typeof v==='string'&&v.length<=max&&v.isWellFormed()
  &&!/[\u0000-\u001f]/u.test(v);
const iso=()=>new Date().toISOString();
const key=(v:string)=>({id:v});
const mediaKey=(pageId:string,fileId:string)=>({page_id:pageId,file_id:fileId});
const publicationKey=(pageId:string)=>({page_id:pageId});
const publicKey=(pageId:string)=>({page_id:pageId});
const navId='primary';
const navKey={id:navId};
const pageSummary=(r:Row)=>({id:r.id,slug:r.slug,title:r.title,revision:r.revision,
  publishedRevision:r.published_revision,updatedAt:r.updated_at,publishedAt:r.published_at});
const draftView=(r:Row)=>({...pageSummary(r),sections:r.draft_sections,settings:r.draft_settings,seo:r.draft_seo});
const publishedView=(r:Row)=>({id:r.id,slug:r.published_slug,title:r.published_title,
  sections:r.published_sections,settings:r.published_settings,seo:r.published_seo,
  publishedRevision:r.published_revision,publishedAt:r.published_at});
const publishedSummary=(r:Row)=>({id:r.id,slug:r.published_slug,title:r.published_title,
  publishedRevision:r.published_revision,publishedAt:r.published_at});
const navView=(r:Row)=>({items:r.draft_items,revision:r.revision,publishedRevision:r.published_revision,
  updatedAt:r.updated_at,publishedAt:r.published_at});
const publishedNav=(r:Row)=>({items:r.published_items,publishedRevision:r.published_revision,
  publishedAt:r.published_at});
const mediaView=(r:Row)=>({pageId:r.page_id,fileId:r.file_id,filename:r.filename,
  contentType:r.content_type,byteSize:r.byte_size,reference:{fileId:r.file_id,
    intentId:r.intent_id,generation:r.generation,digest:r.digest}});
const limit=(v:unknown)=>Number.isSafeInteger(v)&&Number(v)>=1&&Number(v)<=50?Number(v):fail('invalid_input');
const cursor=(v:unknown,scope:Record<string,unknown>):Row|null=>{
  if(v===undefined)return null;
  if(typeof v!=='string'||v.length>2048)fail('invalid_input');
  try{
    const decoded=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(
      atob((v as string).replaceAll('-','+').replaceAll('_','/')),character=>character.charCodeAt(0))));
    if(!decoded||typeof decoded!=='object'||Array.isArray(decoded)||decoded.v!==1
      ||Object.entries(scope).some(([name,part])=>decoded[name]!==part)
      ||decoded.after!==null&&(typeof decoded.after!=='object'||Array.isArray(decoded.after)))throw 0;
    return decoded.after as Row|null;
  }catch{return fail('invalid_input');}
};
const continuation=(after:Row|null,scope:Record<string,unknown>):string|null=>{
  if(!after)return null;
  const bytes=new TextEncoder().encode(JSON.stringify({v:1,...scope,after}));
  return btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
};
async function page(c:OperationContext,pageId:unknown):Promise<Row>{
  if(!id(pageId))fail('invalid_input');
  const row=await c.data.get('page',{key:key(String(pageId))}) as Row|null;
  if(!row)throw new OperationError('not_found');
  return row;
}
async function navigation(c:OperationContext):Promise<Row|null>{
  return await c.data.get('navigation',{key:navKey}) as Row|null;
}
const safeHref=(v:string)=>!/[\\\u0000-\u001f]/u.test(v)&&(v.startsWith('/')&&!v.startsWith('//')
  ||/^https?:\/\//u.test(v)&&(()=>{try{const u=new URL(v);return !u.username&&!u.password;}catch{return false;}})());
function inspectContent(value:unknown,keyName='',depth=0):void{
  if(depth>6)fail('invalid_input');
  if(typeof value==='string'){
    if(value.length>4000||!value.isWellFormed()||/(?:href|url)$/i.test(keyName)&&value&&!safeHref(value)
      ||/FileId$/u.test(keyName)&&value&&!/^f1_[a-f0-9]{64}$/u.test(value))
      fail('invalid_input');
  }else if(Array.isArray(value)){
    if(value.length>100)fail('invalid_input');
    for(const child of value)inspectContent(child,'',depth+1);
  }else if(value&&typeof value==='object'){
    if(Object.keys(value).length>100)fail('invalid_input');
    for(const [name,child] of Object.entries(value))inspectContent(child,name,depth+1);
  }else if(value!==null&&typeof value!=='number'&&typeof value!=='boolean')fail('invalid_input');
}
function sections(v:unknown):JsonValue{
  if(!Array.isArray(v)||v.length>30)fail('invalid_input');
  const seen=new Set<string>();
  const clean=(v as any[]).map((part:any)=>{
    if(!part||typeof part!=='object'||Array.isArray(part)||!id(part.id)||seen.has(part.id)
      ||!['hero','features','pricing','cta','footer'].includes(part.kind)
      ||!Number.isSafeInteger(part.position)||part.position<0||part.position>10000
      ||typeof part.enabled!=='boolean'||!part.content||typeof part.content!=='object'||Array.isArray(part.content))
      fail('invalid_input');
    seen.add(part.id);
    inspectContent(part.content);
    return {id:part.id,kind:part.kind,position:part.position,enabled:part.enabled,content:part.content};
  });
  if(new TextEncoder().encode(JSON.stringify(clean)).length>28_000)fail('invalid_input');
  return clean as JsonValue;
}
function settings(v:unknown):JsonValue{
  if(!v||typeof v!=='object'||Array.isArray(v))fail('invalid_input');
  const allowed=['brandName','tagline','accent','background','logoUrl','logoFileId'];
  if(Object.keys(v as object).some(name=>!allowed.includes(name)))fail('invalid_input');
  const clean:Record<string,string>={};
  for(const [name,value] of Object.entries(v as object)){
    if(!line(value,500))fail('invalid_input');
    if(name==='logoUrl'&&value&&!safeHref(value))fail('invalid_input');
    if(name==='logoFileId'&&value&&!/^f1_[a-f0-9]{64}$/u.test(value))fail('invalid_input');
    if((name==='accent'||name==='background')&&value&&!/^#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?$/u.test(value))
      fail('invalid_input');
    clean[name]=value;
  }
  return clean;
}
function seo(v:unknown):JsonValue{
  if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v as object).some(k=>!['title','description','canonical'].includes(k)))
    fail('invalid_input');
  const result:Record<string,string>={};
  for(const [name,value] of Object.entries(v as object)){
    if(!line(value,name==='description'?500:240))fail('invalid_input');
    if(name==='canonical'&&value&&!safeHref(value))fail('invalid_input');
    result[name]=value;
  }
  return result;
}
function navItems(v:unknown):JsonValue{
  if(!Array.isArray(v)||v.length>100)fail('invalid_input');
  const seen=new Set<string>();
  const clean=(v as any[]).map((item:any)=>{
    if(!item||typeof item!=='object'||Array.isArray(item)||!id(item.id)||seen.has(item.id)
      ||!line(item.label,120)||!item.label||!line(item.href,512)||!safeHref(item.href)
      ||!line(item.icon,80)||!line(item.group,80)
      ||!Number.isSafeInteger(item.order)||item.order<0||item.order>10000||typeof item.hidden!=='boolean'
      ||item.pageSlug!==undefined&&(!line(item.pageSlug,160)||!/^\/[A-Za-z0-9/_-]*$/u.test(item.pageSlug)
        ||item.href!==item.pageSlug))fail('invalid_input');
    seen.add(item.id);
    return {id:item.id,label:item.label,href:item.href,icon:item.icon,group:item.group,
      order:item.order,hidden:item.hidden,...(item.pageSlug?{pageSlug:item.pageSlug}:{})};
  });
  return clean as JsonValue;
}
export async function pageList(value:JsonValue,c:OperationContext){
  const a=arg(value),n=limit(a.limit),scope={context:c.contextId,kind:'draft'};
  const result=await c.data.list('page',{limit:n,after:cursor(a.cursor,scope),
    order:{indexId:'recent-pages',direction:'desc'},
    fields:['id','slug','title','revision','published_revision','updated_at','published_at']}) as Page;
  return {output:{items:result.items.map(pageSummary),nextCursor:continuation(result.nextAfter,scope)}};
}
export async function pageCreate(value:JsonValue,c:OperationContext){
  const a=arg(value);
  if(!id(a.id)||!line(a.slug,160)||!/^\/[A-Za-z0-9/_-]*$/u.test(a.slug)
    ||!line(a.title,240)||!a.title.trim())fail('invalid_input');
  const at=iso(),row:Row={id:a.id,slug:a.slug,title:a.title.trim(),draft_sections:[],draft_settings:{},draft_seo:{},
    published_slug:null,published_title:null,published_sections:null,published_settings:null,published_seo:null,
    created_at:at,updated_at:at,published_at:null,revision:1,published_revision:0};
  return {output:{page:draftView(row)},plans:[c.data.planCreate('page',{values:row})]};
}
export async function pageRead(value:JsonValue,c:OperationContext){return {output:{page:draftView(await page(c,arg(value).pageId))}};}
export async function pageVisibility(value:JsonValue,c:OperationContext){
  const row=await page(c,arg(value).pageId);
  const marker=await c.data.get('public_page',{key:publicKey(String(row.id))}) as Row|null;
  const visible=!!marker&&marker.published_revision===row.published_revision;
  return {output:{visibility:visible?'public':'protected',slug:visible?row.published_slug:null}};
}
export async function pageSave(value:JsonValue,c:OperationContext){
  const a=arg(value),old=await page(c,a.pageId),rev=Number(a.revision);
  if(!Number.isSafeInteger(rev)||rev!==old.revision)fail('conflict');
  if(!line(a.slug,160)||!/^\/[A-Za-z0-9/_-]*$/u.test(a.slug)||!line(a.title,240)||!a.title.trim())fail('invalid_input');
  const changes={slug:a.slug,title:a.title.trim(),draft_sections:sections(a.sections),
    draft_settings:settings(a.settings),draft_seo:seo(a.seo),updated_at:iso()};
  return {output:{page:draftView({...old,...changes,revision:rev+1})},plans:[
    c.data.planPatch('page',{key:key(a.pageId),compare:{field:'revision',expected:rev},values:changes})]};
}
export async function pagePreview(value:JsonValue,c:OperationContext){
  return {output:{page:draftView(await page(c,arg(value).pageId))}};
}
const imageFileId=(value:unknown):string=>{
  if(value===undefined||value===null||value==='')return '';
  if(typeof value!=='string'||!/^f1_[a-f0-9]{64}$/u.test(value))fail('invalid_input');
  return value as string;
};
/** Only media referenced by visible published prefabs enter the linked-read snapshot. */
function publishedImageIds(row:Row):string[]{
  const ids:string[]=[],add=(value:unknown)=>{const fileId=imageFileId(value);
    if(fileId&&!ids.includes(fileId))ids.push(fileId);};
  const settings=row.draft_settings as Record<string,unknown>;
  const sections=row.draft_sections as Array<{kind:string;enabled:boolean;content:Record<string,unknown>}>;
  for(const section of sections){
    if(!section.enabled)continue;
    if(section.kind==='hero'){add(section.content.logoFileId||settings.logoFileId);add(section.content.imageFileId);}
    if(section.kind==='features'&&Array.isArray(section.content.items))
      for(const item of section.content.items){
        if(item&&typeof item==='object'&&!Array.isArray(item))add((item as Record<string,unknown>).imageFileId);
      }
  }
  if(ids.length>5)fail('invalid_input');
  return ids;
}
export async function pagePublish(value:JsonValue,c:OperationContext){
  const a=arg(value),old=await page(c,a.pageId),rev=Number(a.revision);
  if(!Number.isSafeInteger(rev)||rev!==old.revision)fail('conflict');
  const visibility=a.visibility??'protected';
  if(visibility!=='protected'&&visibility!=='public')fail('invalid_input');
  const ids=publishedImageIds(old),selected:Row[]=[];
  for(const fileId of ids){const row=await c.data.get('page_media',{key:mediaKey(String(a.pageId),fileId)}) as Row|null;
    if(!row||row.page_id!==a.pageId||row.file_id!==fileId)fail('not_found');selected.push(row as Row);}
  const marker=await c.data.get('page_publication',{key:publicationKey(String(a.pageId))}) as Row|null;
  if(marker&&marker.published_revision!==old.published_revision)fail('conflict');
  const publicMarker=await c.data.get('public_page',{key:publicKey(String(a.pageId))}) as Row|null;
  if(publicMarker&&publicMarker.published_revision!==old.published_revision)fail('conflict');
  const existing=await c.data.list('published_page_media',{limit:6,where:{page_id:a.pageId},
    order:{indexId:'by-page',direction:'asc'}}) as Page;
  if(existing.nextAfter||existing.items.length>5)fail('conflict');
  const at=iso(),changes={published_slug:old.slug,published_title:old.title,
    published_sections:old.draft_sections,published_settings:old.draft_settings,published_seo:old.draft_seo,
    published_at:at,published_revision:Number(old.published_revision)+1,updated_at:at};
  const selectedById=new Map(selected.map((row,position)=>[String(row.file_id),{row,position}]));
  const previous=new Map(existing.items.map(row=>[String(row.file_id),row]));
  const plans=[c.data.planPatch('page',{key:key(a.pageId),compare:{field:'revision',expected:rev},values:changes}),
    marker?c.data.planPatch('page_publication',{key:publicationKey(String(a.pageId)),
      compare:{field:'published_revision',expected:Number(old.published_revision)},
      values:{state:'published'}}):
      c.data.planCreate('page_publication',{values:{page_id:a.pageId,state:'published',
        published_revision:changes.published_revision}})];
  if(visibility==='public')plans.push(publicMarker?
    c.data.planPatch('public_page',{key:publicKey(String(a.pageId)),
      compare:{field:'published_revision',expected:Number(old.published_revision)},
      values:{enabled_at:at}}):
    c.data.planCreate('public_page',{values:{page_id:a.pageId,
      published_revision:changes.published_revision,enabled_at:at}}));
  else if(publicMarker)plans.push(c.data.planDelete('public_page',{key:publicKey(String(a.pageId)),
    compare:{field:'published_revision',expected:Number(old.published_revision)}}));
  for(const [fileId,row] of previous){
    const wanted=selectedById.get(fileId);
    if(!wanted)
      plans.push(c.data.planDelete('published_page_media',{key:mediaKey(String(a.pageId),fileId)}));
    else if(row.position!==wanted.position||row.digest!==wanted.row.digest||
      row.intent_id!==wanted.row.intent_id||row.generation!==wanted.row.generation)
      plans.push(c.data.planPatch('published_page_media',{key:mediaKey(String(a.pageId),fileId),
        values:{position:wanted.position,filename:wanted.row.filename,content_type:wanted.row.content_type,
          byte_size:wanted.row.byte_size,digest:wanted.row.digest,intent_id:wanted.row.intent_id,
          generation:wanted.row.generation}}));
  }
  for(const [fileId,{row,position}] of selectedById){
    if(!previous.has(fileId))
      plans.push(c.data.planCreate('published_page_media',{values:{page_id:a.pageId,file_id:fileId,
        filename:row.filename,content_type:row.content_type,byte_size:row.byte_size,
        digest:row.digest,intent_id:row.intent_id,generation:row.generation,position}}));
  }
  if(plans.length>16)fail('invalid_input');
  return {output:{page:publishedView({...old,...changes})},plans};
}
export async function pageReset(value:JsonValue,c:OperationContext){
  const a=arg(value),old=await page(c,a.pageId),rev=Number(a.revision);
  if(!Number.isSafeInteger(rev)||rev!==old.revision)fail('conflict');
  const published=await c.data.list('published_page_media',{limit:6,where:{page_id:a.pageId},
    order:{indexId:'by-page',direction:'asc'}}) as Page;
  if(published.nextAfter||published.items.length>5)fail('conflict');
  const changes={slug:old.published_slug??old.slug,title:old.published_title??old.title,
    draft_sections:old.published_sections??[],draft_settings:old.published_settings??{},
    draft_seo:old.published_seo??{},updated_at:iso()};
  const plans=[c.data.planPatch('page',{key:key(a.pageId),compare:{field:'revision',expected:rev},values:changes})];
  for(const item of published.items){
    const fileId=String(item.file_id),draft=await c.data.get('page_media',
      {key:mediaKey(String(a.pageId),fileId)}) as Row|null;
    if(draft){if(draft.digest!==item.digest||draft.intent_id!==item.intent_id||
      draft.generation!==item.generation)fail('conflict');continue;}
    plans.push(c.data.planCreate('page_media',{values:{page_id:a.pageId,file_id:fileId,
      filename:item.filename,content_type:item.content_type,byte_size:item.byte_size,
      digest:item.digest,intent_id:item.intent_id,generation:item.generation,created_at:iso()}}));
  }
  return {output:{page:draftView({...old,...changes,revision:rev+1})},plans};
}
export async function pagePublishedList(value:JsonValue,c:OperationContext){
  const a=arg(value),n=limit(a.limit),scope={context:c.contextId,kind:'published'};
  const result=await c.data.list('page',{limit:n,after:cursor(a.cursor,scope),
    order:{indexId:'recent-pages',direction:'desc'},
    fields:['id','updated_at','published_slug','published_title','published_revision','published_at']}) as Page;
  return {output:{items:result.items.filter(row=>row.published_at!==null).map(publishedSummary),
    nextCursor:continuation(result.nextAfter,scope)}};
}
export async function pagePublishedRead(value:JsonValue,c:OperationContext){
  const row=await page(c,arg(value).pageId);
  if(row.published_at===null)fail('not_found');
  return {output:{page:publishedView(row)}};
}
/** Resolve only a published slug, using the context-scoped unique index. */
export async function pagePublishedResolve(value:JsonValue,c:OperationContext){
  const slug=arg(value).slug;
  if(typeof slug!=='string'||slug.length>160||!/^\/[A-Za-z0-9/_-]*$/u.test(slug))fail('invalid_input');
  const result=await c.data.list('page',{limit:1,where:{published_slug:slug},
    fields:['id','published_slug','published_at']}) as Page;
  const row=result.items[0];
  if(!row||row.published_slug!==slug||row.published_at===null)fail('not_found');
  return {output:{pageId:row.id,slug:row.published_slug}};
}
export async function navigationRead(_value:JsonValue,c:OperationContext){
  const row=await navigation(c);
  return {output:{navigation:row?navView(row):{items:[],revision:0,publishedRevision:0,updatedAt:null,publishedAt:null}}};
}
export async function navigationSave(value:JsonValue,c:OperationContext){
  const a=arg(value),old=await navigation(c),rev=Number(a.revision);
  if(!Number.isSafeInteger(rev)||rev!==(old?.revision??0))fail('conflict');
  const items=navItems(a.items),at=iso();
  const row:Row=old?{...old,draft_items:items,updated_at:at,revision:rev+1}:
    {id:navId,draft_items:items,published_items:[],updated_at:at,published_at:null,revision:1,published_revision:0};
  const plan=old?c.data.planPatch('navigation',{key:navKey,compare:{field:'revision',expected:rev},
    values:{draft_items:items,updated_at:at}}):c.data.planCreate('navigation',{values:row});
  return {output:{navigation:navView(row)},plans:[plan]};
}
export async function navigationPublish(value:JsonValue,c:OperationContext){
  const a=arg(value),old=await navigation(c);
  if(!old)throw new OperationError('not_found');
  const rev=Number(a.revision);if(!Number.isSafeInteger(rev)||rev!==old.revision)fail('conflict');
  const linked=new Set((old.draft_items as Array<{pageSlug?:string}>).map(item=>item.pageSlug)
    .filter((slug):slug is string=>typeof slug==='string'));
  for(const slug of linked){
    const found=await c.data.list('page',{limit:1,where:{published_slug:slug},
      fields:['id','published_slug','published_at']}) as Page;
    if(!found.items[0]||found.items[0].published_at===null)fail('not_found');
  }
  const at=iso(),changes={published_items:old.draft_items,published_at:at,
    published_revision:Number(old.published_revision)+1,updated_at:at};
  return {output:{navigation:publishedNav({...old,...changes})},plans:[
    c.data.planPatch('navigation',{key:navKey,compare:{field:'revision',expected:rev},values:changes})]};
}
export async function navigationReset(value:JsonValue,c:OperationContext){
  const a=arg(value),old=await navigation(c);
  if(!old)throw new OperationError('not_found');
  const rev=Number(a.revision);if(!Number.isSafeInteger(rev)||rev!==old.revision)fail('conflict');
  const changes={draft_items:old.published_items,updated_at:iso()};
  return {output:{navigation:navView({...old,...changes,revision:rev+1})},plans:[
    c.data.planPatch('navigation',{key:navKey,compare:{field:'revision',expected:rev},values:changes})]};
}
export async function navigationPublished(_value:JsonValue,c:OperationContext){
  const row=await navigation(c);
  return {output:{navigation:row?publishedNav(row):{items:[],publishedRevision:0,publishedAt:null}}};
}
export async function mediaList(value:JsonValue,c:OperationContext){
  const a=arg(value);await page(c,a.pageId);const n=limit(a.limit),scope={context:c.contextId,pageId:a.pageId};
  const result=await c.data.list('page_media',{limit:n,where:{page_id:a.pageId},after:cursor(a.cursor,scope),
    order:{indexId:'by-page',direction:'desc'}}) as Page;
  return {output:{items:result.items.map(mediaView),nextCursor:continuation(result.nextAfter,scope)}};
}
export async function publishedMediaList(value:JsonValue,c:OperationContext){
  const a=arg(value),parent=await page(c,a.pageId);
  if(parent.published_at===null)fail('not_found');
  const marker=await c.data.get('page_publication',{key:publicationKey(String(a.pageId))}) as Row|null;
  if(!marker)return {output:{items:[]}}; // Legacy published pages continue to use external image URLs.
  if(marker.state!=='published'||marker.published_revision!==parent.published_revision)fail('conflict');
  const result=await c.data.list('published_page_media',{limit:6,where:{page_id:a.pageId},
    order:{indexId:'by-page',direction:'asc'}}) as Page;
  if(result.nextAfter||result.items.length>5)fail('conflict');
  return {output:{items:result.items.map(mediaView)}};
}
export async function mediaLink(value:JsonValue,c:OperationContext){
  const a=arg(value),parent=await page(c,a.pageId),rev=Number(a.revision);
  if(!Number.isSafeInteger(rev)||rev!==parent.revision)fail('conflict');
  if(!a.staged||typeof a.staged!=='object'||Array.isArray(a.staged))fail('invalid_input');
  if(!c.files)fail('unavailable');
  const staged=a.staged as {fileId:string;intentId:string;generation:string;digest:string};
  const prepared=await c.files!.preparePublication('media',staged),at=iso();
  const row={page_id:a.pageId,file_id:staged.fileId,filename:prepared.file.filename,
    content_type:prepared.file.contentType,byte_size:prepared.file.byteSize,digest:staged.digest,
    intent_id:staged.intentId,generation:staged.generation,created_at:at};
  return {output:{media:mediaView(row),page:pageSummary({...parent,revision:rev+1,updated_at:at})},plans:[
    prepared.plan,c.data.planGet('page',{key:key(a.pageId),required:true}),
    c.data.planCreate('page_media',{values:row}),
    c.data.planPatch('page',{key:key(a.pageId),compare:{field:'revision',expected:rev},values:{updated_at:at}})]};
}
export async function mediaUnlink(value:JsonValue,c:OperationContext){
  const a=arg(value),parent=await page(c,a.pageId),rev=Number(a.revision);
  if(!Number.isSafeInteger(rev)||rev!==parent.revision||!id(a.fileId))fail('conflict');
  const link=await c.data.get('page_media',{key:mediaKey(a.pageId,a.fileId)}) as Row|null;
  if(!link)fail('not_found');
  const at=iso();
  return {output:{removed:true,page:pageSummary({...parent,revision:rev+1,updated_at:at})},plans:[
    c.data.planDelete('page_media',{key:mediaKey(a.pageId,a.fileId)}),
    c.data.planPatch('page',{key:key(a.pageId),compare:{field:'revision',expected:rev},values:{updated_at:at}})]};
}
