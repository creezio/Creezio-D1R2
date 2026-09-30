import {createDataAccess,createDataTransactionExecutor} from '../data/service.ts';
import {DataAccessError,type DataAccess, type DataCredential,type DataLease,type RuntimeDataCatalog,
  type PermissionDefinition} from '../data/types.ts';
import type {AuthorizationActor} from '../authorization/types.ts';
import type {IdentityDatabase} from '../identity/d1-store.ts';
import {OPERATION_TABLES} from './models.ts';
import type {OperationRegistry} from './registry.ts';
import type {OperationHttpBinding} from './http-types.ts';
import {OperationError} from './types.ts';
import {ANALYTICS_COLLECTION_POLICY_TABLE} from './transport-diagnostics.ts';

export interface OperationDiagnosticsPort {
  collectionFlags():Promise<{navigation:boolean;clicks:boolean}>;
  listExecutions(input:Readonly<{period:'day'|'week'|'month'|'year';limit:number;cursor?:string}>):Promise<{
    period:{period:string;from:string;to:string};items:readonly {
      id:string;moduleId:string;operationId:string;audience:'admin'|'app';state:string;
      errorCode:string|null;createdAt:string;updatedAt:string;durationMs:number|null
    }[];nextCursor:string|null;complete:boolean}>;
  listEndpoints(input:Readonly<{limit:number;cursor?:string}>):Promise<{
    items:readonly {moduleId:string;operationId:string;audience:'admin'|'app';method:string;
      path:string;kind:'query'|'command'}[];nextCursor:string|null;complete:boolean;
    source:'compiled-http-bindings'|'unavailable'
  }>;
}

const periods={day:86_400_000,week:7*86_400_000,month:30*86_400_000} as const;
const fail=():never=>{throw new OperationError('invalid_input');};
const encode=(value:object)=>btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value))))
  .replaceAll('+','-').replaceAll('/','_').replace(/=+$/u,'');
function decode(value:string):Record<string,unknown>{
  if(value.length>2048||!(/^[A-Za-z0-9_-]+$/u.test(value)))return fail();
  try{const json=new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(
    atob(value.replaceAll('-','+').replaceAll('_','/')),char=>char.charCodeAt(0)));
    const parsed=JSON.parse(json);if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))return fail();
    return parsed;
  }catch{return fail();}
}
const checkedLimit=(value:number)=>Number.isSafeInteger(value)&&value>=1&&value<=50?value:fail();
const iso=(value:number)=>new Date(value).toISOString();
const safe=(value:unknown)=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)?value:null;
const start=(period:'day'|'week'|'month'|'year',to:number)=>period==='year'
  ?(date=>{date.setUTCMonth(date.getUTCMonth()-12);return date.getTime();})(new Date(to))
  :to-periods[period];

/** Host-owned projections of the existing operation journal and build-owned HTTP catalog.
 * No payload, output, credential, request body, outbox receipt or private SQL reaches a module. */
export function createOperationDiagnosticsPort(input:{db:IdentityDatabase;authorityDb:IdentityDatabase;
  data:DataAccess;lease:DataLease;catalog:RuntimeDataCatalog;permissions:readonly PermissionDefinition[];
  credential:DataCredential;actors:readonly AuthorizationActor[];requiredPermissionIds:readonly string[];
  registry:OperationRegistry;httpBindings?:readonly OperationHttpBinding[]}):OperationDiagnosticsPort{
  const identity=input.data.describeLease(input.lease);
  if(identity.moduleId!=='creezio.analytics')throw new OperationError('forbidden');
  const admin=()=>{if(identity.audience!=='admin')throw new OperationError('forbidden');};
  const transaction=createDataTransactionExecutor(input.data,input.db);
  const endpoints=(input.httpBindings??[]).filter(binding=>{
    try{return input.registry.resolve(binding.moduleId,binding.operationId).declaration.audiences.includes(binding.audience);}
    catch{return false;}
  }).map(binding=>({moduleId:binding.moduleId,operationId:binding.operationId,
    audience:binding.audience,method:binding.method,path:binding.path,kind:binding.kind}))
    .sort((a,b)=>[a.moduleId,a.operationId,a.audience,a.method,a.path].join('\0')
      .localeCompare([b.moduleId,b.operationId,b.audience,b.method,b.path].join('\0')));
  const port:OperationDiagnosticsPort={
    async collectionFlags(){
      let result;
      try{
        const query={write:false as const,before:[{sql:
          `SELECT navigation_enabled,clicks_enabled FROM ${ANALYTICS_COLLECTION_POLICY_TABLE}
            WHERE id='application' LIMIT 1`,bindings:[]}]};
        if(input.authorityDb===input.db)result=await transaction.execute(input.lease,query);
        else{
          // Recheck the routed lease, then independently authorize the same actor
          // on primary D1. The fixed projection never reads a tenant business row.
          await transaction.execute(input.lease,{write:false});
          const authorityData=createDataAccess(input.authorityDb,{catalog:input.catalog,
            permissions:input.permissions});
          const primaryLease=await authorityData.authorize(input.credential,{contextId:identity.contextId,
            audience:identity.audience,actors:input.actors,
            requiredPermissionIds:input.requiredPermissionIds,purpose:'operation'},
            {moduleId:'creezio.analytics'});
          try{
            const primary=authorityData.describeLease(primaryLease);
            if(primary.moduleId!==identity.moduleId||primary.contextId!==identity.contextId
              ||primary.audience!==identity.audience||primary.principalId!==identity.principalId
              ||primary.actorPrincipalId!==identity.actorPrincipalId
              ||primary.credentialKind!==identity.credentialKind)throw new OperationError('forbidden');
            result=await createDataTransactionExecutor(authorityData,input.authorityDb)
              .execute(primaryLease,query);
          }finally{authorityData.dispose(primaryLease);}
        }
      }catch(error){
        if(error instanceof OperationError)throw error;
        if(error instanceof DataAccessError&&['forbidden','unauthorized'].includes(error.code))
          throw new OperationError(error.code as 'forbidden'|'unauthorized');
        throw new OperationError('unavailable');
      }
      const row=result.before[0]?.results?.[0];
      return {navigation:row?.navigation_enabled===1,clicks:row?.clicks_enabled===1};
    },
    async listExecutions(raw){
      admin();
      const limit=checkedLimit(raw.limit),period=raw.period;
      if(period!=='day'&&period!=='week'&&period!=='month'&&period!=='year')return fail();
      let to=Date.now(),from=start(period,to),afterTime=Number.MAX_SAFE_INTEGER,afterId='';
      if(raw.cursor!==undefined){const cursor=decode(raw.cursor);
        if(cursor.v!==1||cursor.kind!=='executions'||cursor.context!==identity.contextId||cursor.period!==period
          ||!Number.isSafeInteger(cursor.to)||Number(cursor.to)>Date.now()||Number(cursor.to)<0
          ||!Number.isSafeInteger(cursor.from)||Number(cursor.from)<0
          ||Number(cursor.from)!==start(period,Number(cursor.to))
          ||!Number.isSafeInteger(cursor.afterTime)||Number(cursor.afterTime)<Number(cursor.from)
          ||Number(cursor.afterTime)>Number(cursor.to)||!safe(cursor.afterId))return fail();
        to=Number(cursor.to);from=Number(cursor.from);afterTime=Number(cursor.afterTime);afterId=String(cursor.afterId);
      }
      const table=`"${OPERATION_TABLES.executions}"`;
      let results;
      try{results=await transaction.execute(input.lease,{write:false,before:[{sql:
        `SELECT id,module_id,operation_id,audience,state,error_code,created_at_ms,updated_at_ms,claim_expires_at_ms
         FROM ${table} WHERE context_id=? AND created_at_ms>=? AND created_at_ms<=?
         AND (created_at_ms<? OR (created_at_ms=? AND id<?))
         ORDER BY created_at_ms DESC,id DESC LIMIT ?`,
        bindings:[identity.contextId,from,to,afterTime,afterTime,afterId||'~',limit+1]}]});}
      catch{throw new OperationError('unavailable');}
      const rows=results.before[0]?.results;
      if(!Array.isArray(rows))throw new OperationError('unavailable');
      const more=rows.length>limit,selected=rows.slice(0,limit),last=selected.at(-1);
      const items=selected.map(row=>({id:String(row.id),moduleId:String(row.module_id),
        operationId:String(row.operation_id),audience:row.audience as 'admin'|'app',
        state:row.state==='running'&&Number(row.claim_expires_at_ms)<=Date.now()?'unknown':String(row.state),
        errorCode:safe(row.error_code),createdAt:iso(Number(row.created_at_ms)),
        updatedAt:iso(Number(row.updated_at_ms)),durationMs:row.state==='running'?null:
          Math.max(0,Number(row.updated_at_ms)-Number(row.created_at_ms))}));
      return {period:{period,from:iso(from),to:iso(to)},items,
        nextCursor:more&&last?encode({v:1,kind:'executions',context:identity.contextId,period,to,from,
          afterTime:last.created_at_ms,afterId:last.id}):null,complete:!more};
    },
    async listEndpoints(raw){
      admin();
      const limit=checkedLimit(raw.limit);
      let offset=0;
      if(raw.cursor!==undefined){const cursor=decode(raw.cursor);
        if(cursor.v!==1||cursor.kind!=='endpoints'||cursor.context!==identity.contextId
          ||cursor.digest!==input.registry.compositionDigest||!Number.isSafeInteger(cursor.offset)
          ||Number(cursor.offset)<0||Number(cursor.offset)>endpoints.length)return fail();
        offset=Number(cursor.offset);
      }
      const items=endpoints.slice(offset,offset+limit),next=offset+items.length;
      return {items,nextCursor:next<endpoints.length?encode({v:1,kind:'endpoints',context:identity.contextId,
        digest:input.registry.compositionDigest,offset:next}):null,complete:next>=endpoints.length,
        source:input.httpBindings?'compiled-http-bindings':'unavailable'};
    },
  };
  return Object.freeze(port);
}
