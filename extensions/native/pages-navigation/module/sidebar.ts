import {OperationError,type OperationContext,type JsonValue} from '@creezio/sdk/operations/handler';
import type {WorkspaceNavigationCatalogPortV1,WorkspaceNavigationProjectionV1} from '@creezio/sdk/workspace/navigation-catalog';

type Override={hidden?:boolean;title?:string;order?:number};
type Stored=Record<string,Override>;
type Row=Record<string,JsonValue>;
const key={id:'workspace'};
const safeId=(value:unknown):value is string=>typeof value==='string'&&
  value.length>0&&value.length<=128&&/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
const port=(context:OperationContext):WorkspaceNavigationCatalogPortV1=>{
  const selected=(context as OperationContext&{workspaceNavigation?:WorkspaceNavigationCatalogPortV1}).workspaceNavigation;
  if(!selected)throw new OperationError('unavailable');
  return selected;
};
const catalog=async(context:OperationContext):Promise<WorkspaceNavigationProjectionV1>=>
  await port(context).read();
const row=async(context:OperationContext)=>await context.data.get('sidebar_overrides',{key}) as Row|null;
function stored(value:Row|null):Stored{
  if(!value)return {};
  const raw=value.overrides;
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).length>100)
    throw new OperationError('unavailable');
  const result:Stored={};
  for(const [id,entry] of Object.entries(raw)){
    if(!safeId(id)||!entry||typeof entry!=='object'||Array.isArray(entry))
      throw new OperationError('unavailable');
    const item=entry as Record<string,unknown>;
    if(Object.keys(item).some(name=>!['hidden','title','order'].includes(name))
      ||item.hidden!==undefined&&typeof item.hidden!=='boolean'
      ||item.title!==undefined&&(typeof item.title!=='string'||item.title.length<1||item.title.length>120)
      ||item.order!==undefined&&(!Number.isSafeInteger(item.order)||Number(item.order)<0||Number(item.order)>10000))
      throw new OperationError('unavailable');
    result[id]={...(item.hidden!==undefined?{hidden:item.hidden}:{}),
      ...(item.title!==undefined?{title:item.title as string}:{}),
      ...(item.order!==undefined?{order:item.order as number}:{})};
  }
  if(new TextEncoder().encode(JSON.stringify(result)).length>24_000)throw new OperationError('unavailable');
  return result;
}
function metadata(source:WorkspaceNavigationProjectionV1,revision:number){
  return {compositionDigest:source.compositionDigest,contextId:source.contextId,
    audience:source.audience,sessionId:source.sessionId,epoch:source.epoch,revision};
}
export async function sidebarCatalog(_input:JsonValue,context:OperationContext){
  const source=await catalog(context),saved=await row(context),overrides=stored(saved);
  const entries=source.entries.filter(entry=>entry.available).map(entry=>{const override=overrides[entry.id];
    return {...entry,hidden:override?.hidden===true,displayTitle:override?.title??entry.title,
      displayOrder:override?.order??entry.order};});
  return {output:{...metadata(source,Number(saved?.revision??0)),entries}};
}
export async function sidebarResolved(_input:JsonValue,context:OperationContext){
  const source=await catalog(context),saved=await row(context),overrides=stored(saved);
  const items=source.entries.filter(entry=>entry.available&&overrides[entry.id]?.hidden!==true)
    .map(entry=>({id:entry.id,viewId:entry.viewId,title:overrides[entry.id]?.title??entry.title,
      order:overrides[entry.id]?.order??entry.order}))
    .sort((a,b)=>a.order-b.order||a.id.localeCompare(b.id));
  return {output:{...metadata(source,Number(saved?.revision??0)),items}};
}
export async function sidebarSave(value:JsonValue,context:OperationContext){
  const input=value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
  const source=await catalog(context),prior=await row(context),revision=Number(prior?.revision??0);
  if(source.audience!=='admin'||!Number.isSafeInteger(input.expectedRevision)
    ||input.expectedRevision!==revision||!Array.isArray(input.edits)||!Array.isArray(input.resetIds)
    ||input.edits.length>100||input.resetIds.length>100)throw new OperationError('conflict');
  const entries=new Map(source.entries.filter(entry=>entry.available).map(entry=>[entry.id,entry]));
  const next=stored(prior),seen=new Set<string>();
  for(const raw of input.edits){
    if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new OperationError('invalid_input');
    const edit=raw as Record<string,unknown>,id=edit.id;
    if(!safeId(id)||!entries.has(id)||seen.has(id)
      ||Object.keys(edit).some(name=>!['id','hidden','title','order'].includes(name))
      ||!['hidden','title','order'].some(name=>Object.hasOwn(edit,name)))
      throw new OperationError('invalid_input');
    seen.add(id);
    const changed:Override={...next[id]};
    if(Object.hasOwn(edit,'hidden')){
      if(typeof edit.hidden!=='boolean')throw new OperationError('invalid_input');
      changed.hidden=edit.hidden;
    }
    if(Object.hasOwn(edit,'title')){
      if(typeof edit.title!=='string'||!edit.title.trim()||edit.title.length>120
        ||!edit.title.isWellFormed()||/[\u0000-\u001f\u007f]/.test(edit.title))
        throw new OperationError('invalid_input');
      changed.title=edit.title.trim();
    }
    if(Object.hasOwn(edit,'order')){
      if(!Number.isSafeInteger(edit.order)||Number(edit.order)<0||Number(edit.order)>10000)
        throw new OperationError('invalid_input');
      changed.order=Number(edit.order);
    }
    next[id]=changed;
  }
  for(const id of input.resetIds){
    if(!safeId(id)||seen.has(id)||!entries.has(id))
      throw new OperationError('invalid_input');
    seen.add(id);delete next[id];
  }
  if(Object.keys(next).length>100||new TextEncoder().encode(JSON.stringify(next)).length>24_000)
    throw new OperationError('invalid_input');
  const now=new Date().toISOString(),changes={overrides:next,updated_at:now,updated_by:context.principalId};
  const plan=prior?context.data.planPatch('sidebar_overrides',{
    key,compare:{field:'revision',expected:revision},values:changes}):
    context.data.planCreate('sidebar_overrides',{values:{id:'workspace',...changes,revision:1}});
  return {output:{revision:revision+1,updatedAt:now,updatedBy:context.principalId},plans:[plan]};
}
