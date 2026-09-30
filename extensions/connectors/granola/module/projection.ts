import {OperationError,type JsonValue} from '@creezio/sdk/operations/handler';

type Row=Record<string,JsonValue>;
const fail=():never=>{throw new OperationError('unavailable');};
const object=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)
  ?value as Record<string,unknown>:fail();
const text=(value:unknown,max:number,nullable=false):string|null=>{
  if(value===null&&nullable)return null;
  if(typeof value!=='string'||value.length>max||!value.isWellFormed()||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value))return fail();
  return value;
};
const date=(value:unknown,nullable=false):string|null=>{
  const result=text(value,40,nullable);
  if(result!==null&&(!/^\d{4}-\d\d-\d\dT/u.test(result)||!Number.isFinite(Date.parse(result))))return fail();
  return result===null?null:new Date(result).toISOString();
};
const owner=(value:unknown):string=>text(object(value).name,256)!;
export const noteId=(value:unknown):string=>{
  const id=text(value,64);
  if(!id||!/^not_[A-Za-z0-9]{14}$/u.test(id))return fail();
  return id;
};
export const folderId=(value:unknown):string=>{
  const id=text(value,64);
  if(!id||!/^fol_[A-Za-z0-9]{14}$/u.test(id))return fail();
  return id;
};
export const remoteCursor=(value:unknown):string|null=>{
  if(value===null)return null;
  const cursor=text(value,512);
  if(!cursor||/[\r\n]/u.test(cursor))return fail();
  return cursor;
};
const bounded=(row:Row,max=24_576):Row=>new TextEncoder().encode(JSON.stringify(row)).length<=max?row:fail();
export function projectNoteList(body:JsonValue,limit:number){
  const page=object(body);
  if(!Array.isArray(page.notes)||page.notes.length>limit||typeof page.hasMore!=='boolean')return fail();
  const cursor=remoteCursor(page.cursor),seen=new Set<string>(),rows:Row[]=[];
  if(page.hasMore&&!cursor)return fail();
  for(const raw of page.notes){
    const item=object(raw),id=noteId(item.id);
    if(item.object!=='note'||seen.has(id))return fail();seen.add(id);
    rows.push(bounded({id,title:text(item.title,1000,true),owner:owner(item.owner),
      note_created_at:date(item.created_at),note_updated_at:date(item.updated_at)}));
  }
  return {rows,nextCursor:page.hasMore?cursor:null};
}
export function projectFolderList(body:JsonValue,limit:number){
  const page=object(body);
  if(!Array.isArray(page.folders)||page.folders.length>limit||typeof page.hasMore!=='boolean')return fail();
  const cursor=remoteCursor(page.cursor),seen=new Set<string>(),rows:Row[]=[];
  if(page.hasMore&&!cursor)return fail();
  for(const raw of page.folders){
    const item=object(raw),id=folderId(item.id);
    if(item.object!=='folder'||seen.has(id))return fail();seen.add(id);
    rows.push(bounded({id,name:text(item.name,500),parent_folder_id:item.parent_folder_id===null?null:folderId(item.parent_folder_id)}));
  }
  return {rows,nextCursor:page.hasMore?cursor:null};
}
export function projectNoteDetail(body:JsonValue,expectedId:string):Row{
  const item=object(body),id=noteId(item.id);
  if(id!==expectedId||item.object!=='note'||!Array.isArray(item.folder_membership)
    ||item.folder_membership.length>100)return fail();
  const folders=item.folder_membership.map(entry=>folderId(object(entry).id));
  const url=text(item.web_url,2048);
  if(!url||!/^https:\/\/notes\.granola\.ai\//u.test(url))return fail();
  // The source summary is bounded before entering D1. Never silently truncate a supplier document.
  return bounded({id,title:text(item.title,1000,true),owner:owner(item.owner),
    note_created_at:date(item.created_at),note_updated_at:date(item.updated_at),
    folder_id:folders[0]??null,web_url:url,
    summary_text:text(item.summary_text,16_000)},24_576);
}
const cursorTag=(cursor:string|null)=>{
  let hash=2166136261;
  for(const byte of new TextEncoder().encode(cursor??''))hash=Math.imul(hash^byte,16777619);
  return (hash>>>0).toString(16).padStart(8,'0');
};
export function projectTranscript(body:JsonValue,expectedId:string,limit:number,cursor:string|null=null){
  const page=object(body);
  if(!Array.isArray(page.transcript)||page.transcript.length>limit||typeof page.hasMore!=='boolean')return fail();
  const nextCursor=remoteCursor(page.cursor),rows:Row[]=[];
  if(page.hasMore&&!nextCursor)return fail();
  for(let i=0;i<page.transcript.length;i++){
    const segment=object(page.transcript[i]),speaker=object(segment.speaker);
    rows.push(bounded({id:`${expectedId}:${cursorTag(cursor)}:${i}`,note_id:expectedId,text:text(segment.text,8192),
      speaker_name:speaker.name===null||speaker.name===undefined?null:text(speaker.name,256),
      start_time:date(segment.start_time),end_time:date(segment.end_time)},12_288));
  }
  return {rows,nextCursor:page.hasMore?nextCursor:null};
}
