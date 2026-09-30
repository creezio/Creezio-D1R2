import type {AuthorizationActor,AuthorizationAudience} from '../authorization/types.ts';
import type {DataAccess,DataCredential,DataModel,DataRecord,RuntimeDataCatalog} from '../data/types.ts';
import type {ProviderSearchDeclaration,SearchProjectionPort,SearchProjectionSource,SearchProjectionItem}
  from '../../sdk/search/types.ts';

const identifier=/^[A-Za-z][A-Za-z0-9._:-]{0,256}$/u;
const generation=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/u;
const utf8=(value:unknown):value is string=>typeof value==='string'&&value.isWellFormed();
const unique=(items:readonly string[])=>new Set(items).size===items.length;
const bad=()=>new Error('Invalid search projection');

/** Adapt a declared search contract to a fixed owner-model projection policy. */
export function sourceFromSearchContract(declaration:ProviderSearchDeclaration,
  catalog:RuntimeDataCatalog):SearchProjectionSource{
  const policy=declaration?.projection;
  if(!declaration||declaration.engine!=='provider'||declaration.context!=='required'
    ||!policy||typeof declaration.provider!=='string'||!identifier.test(declaration.provider)
    ||declaration.filterBeforeCount!==true
    ||declaration.resumable!==true||declaration.model?.kind!=='model'
    ||!Array.isArray(declaration.permissions)||declaration.permissions.length!==1
    ||declaration.permissions[0].kind!=='permission'
    ||declaration.permissions[0].moduleId!==declaration.model.moduleId
    ||!Array.isArray(declaration.facets)||declaration.facets.some(id=>!declaration.fields.includes(id)))throw bad();
  return captureSearchProjectionSource({id:`${declaration.model.moduleId}:${declaration.id}`,
    moduleId:declaration.model.moduleId,
    modelId:declaration.model.id,permissionId:declaration.permissions[0].id,
    projectionVersion:declaration.projectionVersion,fields:declaration.fields,
    facets:declaration.facets,...policy},catalog);
}

/** Compile active provider declarations from the composed manifest. */
export function compileSearchProjectionSources(declarations:readonly ProviderSearchDeclaration[],
  catalog:RuntimeDataCatalog):readonly SearchProjectionSource[]{
  if(!Array.isArray(declarations))throw bad();
  const seen=new Set<string>();
  const result:SearchProjectionSource[]=[];
  for(const declaration of declarations){
    const key=`${declaration.model?.moduleId}:${declaration.id}`;
    if(seen.has(key))throw bad();
    seen.add(key);
    if(!declaration.projection||typeof declaration.provider!=='string')throw bad();
    result.push(sourceFromSearchContract(declaration,catalog));
  }
  return Object.freeze(result);
}

export function captureSearchProjectionSource(value:SearchProjectionSource,catalog:RuntimeDataCatalog):SearchProjectionSource{
  if(!value||![value.id,value.moduleId,value.modelId,value.permissionId,value.orderIndexId,
    value.idField,value.revisionField,value.visibilityField].every(item=>typeof item==='string'&&identifier.test(item))
    ||!utf8(value.projectionVersion)||value.projectionVersion.length<1||value.projectionVersion.length>64
    ||!utf8(value.visibleValue)||value.visibleValue.length<1||value.visibleValue.length>128
    ||!Array.isArray(value.fields)||value.fields.length<1||value.fields.length>32
    ||!value.fields.every(item=>typeof item==='string'&&identifier.test(item))||!unique(value.fields)
    ||!Array.isArray(value.facets)||value.facets.length>16
    ||!value.facets.every(item=>typeof item==='string'&&value.fields.includes(item))
    ||!unique(value.facets))throw bad();
  const owner=catalog.modules.find(item=>item.moduleId===value.moduleId&&item.enabled);
  const model=owner?.models.find(item=>item.modelId===value.modelId)?.model as DataModel|undefined;
  const permission=owner?.permissions.find(item=>item.id===value.permissionId);
  if(!model||model.scope!=='context'||!model.contextField||!permission
    ||!permission.actions.includes('read')
    ||!permission.resources.some(item=>item.moduleId===value.moduleId&&item.kind==='model'&&item.id===value.modelId)
    ||!model.permissions.some(item=>item.moduleId===value.moduleId&&item.kind==='permission'&&item.id===value.permissionId)
    ||model.primaryKey.join(',')!==[model.contextField,value.idField].join(',')
    ||!model.indexes.some(item=>item.id===value.orderIndexId
      &&item.fields.join(',')===[model.contextField,'updated_at',value.idField].join(',')))throw bad();
  const fields=new Map(model.fields.map(item=>[item.id,item]));
  for(const name of [value.idField,value.revisionField,value.visibilityField,'updated_at',...value.fields]){
    const field=fields.get(name);
    if(!field||field.protected||field.computed||name===model.contextField)throw bad();
  }
  if(fields.get(value.idField)?.type!=='string'||fields.get(value.idField)?.nullable
    ||fields.get(value.revisionField)?.type!=='integer'||fields.get(value.revisionField)?.nullable
    ||fields.get(value.visibilityField)?.type!=='string'||fields.get('updated_at')?.type!=='date-time')throw bad();
  return Object.freeze({...value,fields:Object.freeze([...value.fields]),
    facets:Object.freeze([...value.facets])});
}

/** Per-context, per-generation UID; a caller cannot choose an existing tenant index. */
export async function projectionIndexUid(source:SearchProjectionSource,contextId:string,epoch:string):Promise<string>{
  if(!utf8(contextId)||contextId.length<1||contextId.length>128||!generation.test(epoch))throw bad();
  const material=JSON.stringify([source.moduleId,source.id,source.projectionVersion,contextId,epoch]);
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(material));
  return `cz_${[...new Uint8Array(hash)].map(byte=>byte.toString(16).padStart(2,'0')).join('').slice(0,48)}`;
}

export interface SearchProjectionScope {
  readonly credential:DataCredential;
  readonly contextId:string;
  readonly audience:AuthorizationAudience;
  readonly actors:readonly AuthorizationActor[];
  readonly ensureActive:()=>void;
}
export function createSearchProjectionHost(options:Readonly<{data:DataAccess;catalog:RuntimeDataCatalog;
  sources:readonly SearchProjectionSource[]}>){
  const sources=options.sources.map(item=>captureSearchProjectionSource(item,options.catalog));
  if(!unique(sources.map(item=>item.id)))throw bad();
  const byId=new Map(sources.map(item=>[item.id,item]));
  return Object.freeze({port(scope:SearchProjectionScope):SearchProjectionPort{
    const source=(id:string)=>{const item=byId.get(id);if(!item)throw bad();return item;};
    const withRead=async<T>(item:SearchProjectionSource,read:(port:ReturnType<DataAccess['forModule']>)=>Promise<T>):Promise<T>=>{
      scope.ensureActive();
      const lease=await options.data.authorize(scope.credential,{contextId:scope.contextId,
        audience:scope.audience,actors:scope.actors,
        requiredPermissionIds:[`${item.moduleId}:${item.permissionId}`],purpose:'operation'},
      {moduleId:item.moduleId});
      try{
        scope.ensureActive();
        const result=await read(options.data.forModule(lease,item.moduleId));
        scope.ensureActive();
        const fresh=await options.data.authorize(scope.credential,{contextId:scope.contextId,
          audience:scope.audience,actors:scope.actors,
          requiredPermissionIds:[`${item.moduleId}:${item.permissionId}`],purpose:'operation'},
        {moduleId:item.moduleId});
        options.data.dispose(fresh);
        scope.ensureActive();
        return result;
      }finally{options.data.dispose(lease);}
    };
    const project=(item:SearchProjectionSource,row:DataRecord):SearchProjectionItem=>{
      const id=row[item.idField],revision=row[item.revisionField];
      if(typeof id!=='string'||!Number.isSafeInteger(revision)||Number(revision)<1)throw bad();
      if(row[item.visibilityField]!==item.visibleValue)return Object.freeze({id,revision:Number(revision),deleted:true});
      const fields=Object.fromEntries(item.fields.map(name=>[name,row[name]]));
      if(Object.values(fields).some(value=>value===undefined))throw bad();
      return Object.freeze({id,revision:Number(revision),deleted:false,fields:Object.freeze(fields)});
    };
    const readCursor=(cursor:string|undefined,item:SearchProjectionSource):DataRecord|null=>{
      if(cursor===undefined)return null;
      if(!utf8(cursor)||cursor.length>2048)throw bad();
      let row:unknown;try{row=JSON.parse(cursor);}catch{throw bad();}
      if(!row||typeof row!=='object'||Array.isArray(row))throw bad();
      const value=row as Record<string,unknown>;
      if(Object.keys(value).sort().join(',')!=='after,context,source,version'
        ||value.context!==scope.contextId||value.source!==item.id||value.version!==item.projectionVersion
        ||!value.after||typeof value.after!=='object'||Array.isArray(value.after))throw bad();
      const after=value.after as Record<string,unknown>;
      if(Object.keys(after).sort().join(',')!==['id','updated_at'].sort().join(',')
        ||!utf8(after.id)||!utf8(after.updated_at))throw bad();
      return {[item.idField]:after.id,updated_at:after.updated_at};
    };
    const cursorAfter=(item:SearchProjectionSource,row:DataRecord)=>JSON.stringify({source:item.id,
      version:item.projectionVersion,context:scope.contextId,
      after:{updated_at:row.updated_at,id:row[item.idField]}});
    const port:SearchProjectionPort=Object.freeze({sources(){return Object.freeze([...byId.keys()]);},
      facets(id:string){return source(id).facets;},
      async indexUid(input:Parameters<SearchProjectionPort['indexUid']>[0]){
      scope.ensureActive();
      return projectionIndexUid(source(input.source),scope.contextId,input.epoch);
    },async page(input:Parameters<SearchProjectionPort['page']>[0]){
      const item=source(input.source);
      if(!Number.isSafeInteger(input.limit)||input.limit<1||input.limit>50)throw bad();
      const after=readCursor(input.cursor,item);
      const selected=[...new Set([item.idField,item.revisionField,item.visibilityField,'updated_at',...item.fields])];
      const result=await withRead(item,port=>port.list(item.modelId,{limit:input.limit,
        ...(after?{after}:{}),fields:selected,order:{indexId:item.orderIndexId,direction:'asc'}}));
      const afterEach=result.items.map(row=>cursorAfter(item,row));
      const next=result.nextAfter?afterEach.at(-1)??null:null;
      if(afterEach.some(cursor=>cursor.length>2048))throw bad();
      return Object.freeze({items:Object.freeze(result.items.map(row=>project(item,row))),
        afterEach:Object.freeze(afterEach),nextCursor:next});
    },async reauthorize(input:Parameters<SearchProjectionPort['reauthorize']>[0]){
      const item=source(input.source),ids=input.ids;
      if(!Array.isArray(ids)||ids.length>20||!unique(ids)
        ||ids.some(id=>typeof id!=='string'||id.length<1||id.length>128||!id.isWellFormed()))throw bad();
      const selected=[...new Set([item.idField,item.revisionField,item.visibilityField,...item.fields])];
      return withRead(item,async port=>{
        const found:SearchProjectionItem[]=[];
        for(const id of ids){
          const row=await port.get(item.modelId,{key:{[item.idField]:id},fields:selected});
          if(row){const value=project(item,row);if(!value.deleted)found.push(value);}
        }
        return Object.freeze(found);
      });
    }});
    return port;
  }});
}
