import type {DataAccess,DataCredential,JsonValue} from '../data/types.ts';
import type {AuthorizationAudience,AuthorizationActor} from '../authorization/types.ts';
import type {OperationRegistry} from '../operations/registry.ts';
import type {ProviderTool} from '../../sdk/providers/types.ts';
import {copyJson} from '../data/input.ts';

export interface ProviderOperationSchema {
  readonly moduleId:string;readonly operationId:string;readonly inputSchema:unknown;
  readonly schemaDigest:string;readonly audiences:readonly AuthorizationAudience[];
}
export interface ToolRequest {readonly credential:DataCredential;readonly contextId:string;
  readonly audience:AuthorizationAudience}
export interface ProjectedTool {readonly provider:ProviderTool;readonly moduleId:string;
  readonly operationId:string}
const ID=/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const digest=/^sha256-[a-f0-9]{64}$/;
const plain=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'
  &&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));

/** Conservative Responses strict-schema subset. Unsupported forms are reported, never rewritten. */
export function strictToolSchema(value:unknown,depth=0):boolean {
  if(depth>8||!plain(value)||Object.keys(value).length>64||Object.hasOwn(value,'$ref')
    ||Object.hasOwn(value,'oneOf')||Object.hasOwn(value,'allOf')||Object.hasOwn(value,'if'))return false;
  if(Array.isArray(value.anyOf))return value.anyOf.length>=2&&value.anyOf.length<=4
    &&value.anyOf.every(item=>strictToolSchema(item,depth+1));
  const type=value.type;
  if(type==='object'){
    if(value.additionalProperties!==false||!plain(value.properties)||!Array.isArray(value.required))return false;
    const properties=value.properties as Record<string,unknown>,required=value.required as unknown[];
    const names=Object.keys(properties);
    return names.length<=32&&new Set(required).size===names.length
      &&names.every(name=>name.length<=128&&required.includes(name)
        &&strictToolSchema(properties[name],depth+1));
  }
  if(type==='array')return strictToolSchema(value.items,depth+1)
    &&(value.maxItems===undefined||Number.isSafeInteger(value.maxItems)&&Number(value.maxItems)<=50);
  return ['string','number','integer','boolean','null'].includes(String(type))
    &&(value.enum===undefined||Array.isArray(value.enum)&&value.enum.length<=100);
}
async function toolName(moduleId:string,operationId:string){
  const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`${moduleId}:${operationId}`)));
  return `t_${Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('').slice(0,62)}`;
}

/** The generated schema gives a shape; registry and fresh authorization give authority. */
export async function projectAuthorizedReadTools(options:{readonly catalog:readonly ProviderOperationSchema[];
  readonly registry:OperationRegistry;readonly data:DataAccess;readonly request:ToolRequest}){
  const tools:ProjectedTool[]=[],diagnostics:string[]=[],names=new Set<string>();
  for(const candidate of options.catalog.slice(0,1000)){
    const label=`${candidate.moduleId}:${candidate.operationId}`;
    if(!ID.test(candidate.moduleId)||!ID.test(candidate.operationId)||!digest.test(candidate.schemaDigest)){
      diagnostics.push(`${label}:invalid_catalog`);continue;
    }
    if(!Array.isArray(candidate.audiences)||!candidate.audiences.includes(options.request.audience))continue;
    let registered;
    try{registered=options.registry.resolve(candidate.moduleId,candidate.operationId);}
    catch{diagnostics.push(`${label}:inactive`);continue;}
    const op=registered.declaration;
    if(op.kind!=='query'||op.approval.mode!=='none'||op.effects.writes.length||op.effects.emits.length
      ||op.effects.calls.length||op.effects.providers.length||!op.audiences.includes(options.request.audience)
      ||!op.actors.some(actor=>actor==='user'||actor==='delegated-user'))continue;
    if(!strictToolSchema(candidate.inputSchema)||new TextEncoder().encode(JSON.stringify(candidate.inputSchema)).length>16_384){
      diagnostics.push(`${label}:unsupported_schema`);continue;
    }
    let schema:JsonValue;
    try{schema=copyJson(candidate.inputSchema,16_384);}catch{diagnostics.push(`${label}:invalid_schema`);continue;}
    const actors=op.actors.filter((actor):actor is AuthorizationActor=>actor==='user'||actor==='delegated-user');
    let lease;
    try{lease=await options.data.authorize(options.request.credential,{
      contextId:options.request.contextId,audience:options.request.audience,actors,
      requiredPermissionIds:op.permissions.map(ref=>`${ref.moduleId}:${ref.id}`),purpose:'operation'},
      {moduleId:candidate.moduleId});}
    catch{diagnostics.push(`${label}:forbidden`);continue;}
    finally{if(lease)options.data.dispose(lease);}
    const name=await toolName(candidate.moduleId,candidate.operationId);
    if(names.has(name)){diagnostics.push(`${label}:collision`);continue;}
    names.add(name);
    tools.push({provider:{bindingId:label,name,description:op.title.slice(0,256),
      parameters:schema,schemaDigest:candidate.schemaDigest},
      moduleId:candidate.moduleId,operationId:candidate.operationId});
    if(tools.length>=16){diagnostics.push('catalog:limit');break;}
  }
  return Object.freeze({tools:Object.freeze(tools),diagnostics:Object.freeze(diagnostics)});
}
