import type {DataAccess,DataCredential,JsonValue} from '../data/types.ts';
import type {AuthorizationAudience,AuthorizationActor} from '../authorization/types.ts';
import type {OperationRegistry} from '../operations/registry.ts';
import type {ProviderTool} from '../../sdk/providers/types.ts';
import {copyJson} from '../data/input.ts';
import type {CompiledWidgetCatalog} from '../../sdk/widgets/catalog.ts';

export interface ProviderOperationSchema {
  readonly moduleId:string;readonly operationId:string;readonly inputSchema:unknown;
  readonly schemaDigest:string;readonly audiences:readonly AuthorizationAudience[];
  /** Bounded annotations extracted from the canonical output schema at composition time. */
  readonly outputDescription?:string;
  readonly widget?:Readonly<{moduleId:string;widgetId:string;version:string;resourceDigest:string;
    toolName:string;operationDigest:string}>;
}
export interface ToolRequest {readonly credential:DataCredential;readonly contextId:string;
  readonly audience:AuthorizationAudience}
export interface ProjectedTool {readonly provider:ProviderTool;readonly moduleId:string;
  readonly operationId:string;readonly widget?:NonNullable<ProviderOperationSchema['widget']>}
const ID=/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const digest=/^sha256-[a-f0-9]{64}$/;
const MAX_TOOLS=128,MAX_TOOLS_JSON_BYTES=64*1024,MAX_DESCRIPTION_BYTES=1024;
const encoder=new TextEncoder();
const utf8Bytes=(value:string)=>encoder.encode(value).length;
const plain=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'
  &&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));

/** Bounded Responses schema subset. Unsupported forms are reported, never rewritten. */
function supportedToolSchema(value:unknown,strict:boolean,depth=0):boolean {
  if(depth>8||!plain(value)||Object.keys(value).length>64||Object.hasOwn(value,'$ref')
    ||Object.hasOwn(value,'oneOf')||Object.hasOwn(value,'allOf')||Object.hasOwn(value,'if'))return false;
  if(Array.isArray(value.anyOf))return value.anyOf.length>=2&&value.anyOf.length<=4
    &&value.anyOf.every(item=>supportedToolSchema(item,strict,depth+1));
  const type=value.type;
  if(type==='object'){
    if(value.additionalProperties!==false||!plain(value.properties)||!Array.isArray(value.required))return false;
    const properties=value.properties as Record<string,unknown>,required=value.required as unknown[];
    const names=Object.keys(properties);
    return names.length<=32&&new Set(required).size===required.length
      &&required.every(name=>typeof name==='string'&&names.includes(name))
      &&(!strict||required.length===names.length)
      &&names.every(name=>name.length<=128
        &&supportedToolSchema(properties[name],strict,depth+1));
  }
  if(type==='array')return supportedToolSchema(value.items,strict,depth+1)
    &&(value.maxItems===undefined||Number.isSafeInteger(value.maxItems)&&Number(value.maxItems)<=50);
  return ['string','number','integer','boolean','null'].includes(String(type))
    &&(value.enum===undefined||Array.isArray(value.enum)&&value.enum.length<=100);
}
/** Conservative Responses strict-schema subset. */
export function strictToolSchema(value:unknown,depth=0):boolean {
  return supportedToolSchema(value,true,depth);
}
async function toolName(moduleId:string,operationId:string){
  const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`${moduleId}:${operationId}`)));
  return `t_${Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('').slice(0,62)}`;
}
function toolDescription(title:string,outputDescription?:string){
  const addition=typeof outputDescription==='string'&&outputDescription
    &&utf8Bytes(outputDescription)<=768&&!/[\u0000-\u001f\u007f]/.test(outputDescription)
    ?` Result fields: ${outputDescription}`:'';
  const titleBudget=MAX_DESCRIPTION_BYTES-utf8Bytes(addition);
  let description='',length=0;
  for(const character of title){
    const size=utf8Bytes(character);
    if(length+size>titleBudget)break;
    description+=character;
    length+=size;
  }
  return description+addition;
}

/** Count the exact JSON UTF-8 sent in OpenAI Responses `tools`, excluding host-only metadata. */
function providerToolBytes(tool:ProviderTool){
  return utf8Bytes(JSON.stringify({type:'function',name:tool.name,description:tool.description,
    parameters:tool.parameters,strict:tool.strict??true}));
}

/** The generated schema gives a shape; registry and fresh authorization give authority. */
export async function projectAuthorizedReadTools(options:{readonly catalog:readonly ProviderOperationSchema[];
  readonly registry:OperationRegistry;readonly data:DataAccess;readonly request:ToolRequest;
  readonly widgets?:CompiledWidgetCatalog}){
  const tools:ProjectedTool[]=[],diagnostics:string[]=[],names=new Set<string>();
  let toolsJsonBytes=2; // JSON array brackets.
  if(options.catalog.length>1000)diagnostics.push('catalog:catalog_limit');
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
    const strict=strictToolSchema(candidate.inputSchema);
    if((!strict&&!supportedToolSchema(candidate.inputSchema,false))
      ||new TextEncoder().encode(JSON.stringify(candidate.inputSchema)).length>16_384){
      diagnostics.push(`${label}:unsupported_schema`);continue;
    }
    const widget=candidate.widget?options.widgets?.widgets.find(item=>item.moduleId===candidate.widget!.moduleId
      &&item.widgetId===candidate.widget!.widgetId&&item.version===candidate.widget!.version
      &&item.resourceDigest===candidate.widget!.resourceDigest
      &&item.audiences.includes(options.request.audience)):undefined;
    if(candidate.widget&&(!widget||candidate.widget.operationDigest!==registered.contractDigest
      ||!widget.renderTools.some(tool=>tool.toolName===candidate.widget!.toolName
        &&tool.operationModuleId===candidate.moduleId&&tool.operationId===candidate.operationId
        &&tool.operationDigest===registered.contractDigest
        &&tool.audiences.includes(options.request.audience)))) {diagnostics.push(`${label}:widget_unavailable`);continue;}
    let schema:JsonValue;
    try{schema=copyJson(candidate.inputSchema,16_384);}catch{diagnostics.push(`${label}:invalid_schema`);continue;}
    const actors=op.actors.filter((actor):actor is AuthorizationActor=>actor==='user'||actor==='delegated-user');
    let lease;
    try{lease=await options.data.authorize(options.request.credential,{
      contextId:options.request.contextId,audience:options.request.audience,actors,
      requiredPermissionIds:op.permissions.map(ref=>`${ref.moduleId}:${ref.id}`),purpose:'operation'},
      {moduleId:candidate.moduleId});}
    catch{diagnostics.push(`${label}:forbidden`);continue;}
    try{if(widget?.permissions.length)options.data.requirePermissions(lease,widget.permissions);}
    catch{diagnostics.push(`${label}:widget_forbidden`);continue;}
    finally{if(lease)options.data.dispose(lease);}
    const name=candidate.widget?.toolName??await toolName(candidate.moduleId,candidate.operationId);
    if(!/^[A-Za-z0-9_.-]{1,128}$/.test(name)){diagnostics.push(`${label}:widget_name`);continue;}
    if(names.has(name)){diagnostics.push(`${label}:collision`);continue;}
    const provider:ProviderTool={bindingId:label,name,
      description:toolDescription(op.title.slice(0,256),candidate.outputDescription),
      parameters:schema,schemaDigest:candidate.schemaDigest,strict};
    if(tools.length>=MAX_TOOLS){diagnostics.push('catalog:count_limit');continue;}
    const addedBytes=providerToolBytes(provider)+(tools.length?1:0);
    if(addedBytes>MAX_TOOLS_JSON_BYTES-toolsJsonBytes){diagnostics.push('catalog:byte_limit');continue;}
    names.add(name);
    toolsJsonBytes+=addedBytes;
    tools.push({provider,
      moduleId:candidate.moduleId,operationId:candidate.operationId,
      ...(candidate.widget?{widget:candidate.widget}:{})});
  }
  return Object.freeze({tools:Object.freeze(tools),diagnostics:Object.freeze(diagnostics)});
}
