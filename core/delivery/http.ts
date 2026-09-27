import {AccessHttpError,readAccessCookie,readAccessJson,resolveAccessHttpConfiguration,
  validateAccessHttpRequest} from '../identity/http-policy.ts';
import {createNativeAuthorizationResolver} from '../authorization/resolver.ts';
import {authorize} from '../authorization/authorize.ts';
import {policySnapshot} from '../authorization/policy.ts';
import type {PermissionDefinition} from '../authorization/types.ts';
import type {RuntimeDataCatalog} from '../data/types.ts';
import type {RuntimeEnvironment} from '../runtime/environment.ts';

const AUTH_PATH='/api/delivery/admin/authorization';
const CONNECTIONS_PATH='/api/delivery/admin/connections';
const PERMISSION='creezio.delivery:manage';
const fail=(code:string,status:number):never=>{throw new AccessHttpError(code,status);};
function result(body:unknown,status:number,requestId:string):Response{
  return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8',
    'cache-control':'no-store','x-content-type-options':'nosniff','x-creezio-request-id':requestId}});
}
function operatorOrigin(raw:unknown,appOrigin:string):string|null{
  if(!raw||typeof raw!=='object')return null;
  const descriptor=Object.getOwnPropertyDescriptor(raw,'CREEZIO_LOCAL_DELIVERY_ORIGIN');
  const value:unknown=descriptor&&Object.hasOwn(descriptor,'value')?descriptor.value:undefined;
  if(typeof value!=='string'||value.length>128)return null;
  try{
    const url=new URL(value),app=new URL(appOrigin);
    return value===url.origin&&url.protocol==='http:'&&url.hostname==='127.0.0.1'
      &&Number(url.port)>=1024&&Number(url.port)<=65535&&url.port!==app.port
      &&!url.username&&!url.password&&!url.search&&!url.hash?value:null;
  }catch{return null;}
}
function connectionsTable(catalog:RuntimeDataCatalog|undefined){
  const modules=catalog?.modules;
  if(!modules)throw new AccessHttpError('runtime_unavailable',503);
  const module=modules.find(item=>item.moduleId==='creezio.openai');
  if(!module||!module.enabled)return null;
  const config=module.models.find(item=>item.modelId==='provider_config');
  const secret=module.models.find(item=>item.modelId==='provider_secret');
  const valid=(value:typeof config)=>value&&typeof value.table==='string'
    &&/^cz_[a-f0-9]+_[a-f0-9]+$/.test(value.table);
  if(!valid(config)||!valid(secret))fail('runtime_unavailable',503);
  return {config:config!.table,secret:secret!.table};
}
async function secretConnections(db:RuntimeEnvironment['bindings']['DB'],catalog:RuntimeDataCatalog|undefined){
  const tables=connectionsTable(catalog);
  if(!tables)return [];
  const response=await db.prepare(`SELECT c.context_id AS contextId,c.id AS bindingId,
    c.model_id AS modelId,c.api_key_ref AS reference FROM "${tables.config}" c
    JOIN "${tables.secret}" s ON s.context_id=c.context_id AND s.id=c.api_key_ref
    WHERE s.binding_id=c.id AND s.state='active'
    ORDER BY c.context_id,c.id LIMIT 1001`).all();
  if(response.success!==true||!Array.isArray(response.results)
    ||response.results.length>1000)fail('runtime_unavailable',503);
  return response.results.map(row=>{
    const value=row as Record<string,unknown>;
    if(typeof value.contextId!=='string'||typeof value.bindingId!=='string'
      ||typeof value.modelId!=='string'||typeof value.reference!=='string'
      ||!value.contextId.isWellFormed()||!value.bindingId.isWellFormed()
      ||!value.modelId.isWellFormed()||value.modelId.length>128
      ||!/^creezio-secret:v1:[a-f0-9-]{36}$/.test(value.reference))
      fail('runtime_unavailable',503);
    return {contextId:value.contextId,reference:value.reference,bindingId:value.bindingId,
      label:`${value.modelId} · ${value.bindingId}`};
  });
}

/** Local native session projection. It issues no new identity and no machine authority. */
export async function dispatchDeliveryAuthorizationHttp(request:Request,environment:RuntimeEnvironment,
  rawEnvironment:unknown,requestId:string,permissions:readonly PermissionDefinition[],
  catalog?:RuntimeDataCatalog):Promise<Response|null>{
  const path=new URL(request.url).pathname;
  if(path!==AUTH_PATH&&path!==CONNECTIONS_PATH)return null;
  if(environment.profile!=='local')return result({error:{code:'not_found'},requestId},404,requestId);
  const configuration=resolveAccessHttpConfiguration(rawEnvironment,environment.profile);
  if(!configuration)return result({error:{code:'runtime_unavailable'},requestId},503,requestId);
  try{
    const mutation=path===AUTH_PATH;
    validateAccessHttpRequest(request,configuration,{mutation});
    if(request.headers.has('authorization'))fail('authentication_required',401);
    if(mutation){
      const body=await readAccessJson(request);
      if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length!==0
        ||![Object.prototype,null].includes(Object.getPrototypeOf(body)))fail('invalid_input',400);
    }
    const declared=permissions.find(permission=>permission.id===PERMISSION);
    if(!declared||declared.audiences.length!==1||declared.audiences[0]!=='admin'
      ||declared.actors.length!==1||declared.actors[0]!=='user')fail('forbidden',403);
    const token=readAccessCookie(request,configuration,'admin');
    if(!token)fail('authentication_required',401);
    const resolver=createNativeAuthorizationResolver(environment.bindings.DB,{permissions});
    const state=await resolver.resolve(token,'admin');
    if(!state)throw new AccessHttpError('authentication_required',401);
    const snapshot=policySnapshot(state.policy,resolver.permissions,state.session);
    if(!authorize(snapshot,{contextId:'application',audience:'admin',actors:['user'],
      requiredPermissionIds:[PERMISSION],purpose:'operation'},state.nowMs).allowed)fail('forbidden',403);
    if(!mutation)return result({secretConnections:await secretConnections(environment.bindings.DB,catalog)},200,requestId);
    const origin=operatorOrigin(rawEnvironment,configuration.origin);
    if(!origin)fail('runtime_unavailable',503);
    return result({principalId:state.session.principalId,sessionId:state.session.id,
      expiresAtMs:state.session.expiresAtMs,epoch:state.epoch,operatorOrigin:origin},200,requestId);
  }catch(error){
    return error instanceof AccessHttpError
      ?result({error:{code:error.code},requestId},error.status,requestId)
      :result({error:{code:'service_unavailable'},requestId},503,requestId);
  }
}
