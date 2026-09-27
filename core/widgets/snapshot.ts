import {copyJson, validId} from '../data/input.ts';
import type {CompiledWidgetCatalog, WidgetCatalogEntry, WidgetValidatorMap} from '../../sdk/widgets/catalog.ts';
import type {WidgetAudience, WidgetMessageContentV1, WidgetMessageInstanceV1} from '../../sdk/widgets/types.ts';

export const WIDGET_SNAPSHOT_LIMITS = Object.freeze({bytes:4096,depth:8,instances:4});
const encoder = new TextEncoder();
const object = (value:unknown):value is Record<string,unknown> => !!value && typeof value==='object' && !Array.isArray(value);
const version = (value:unknown):value is string => typeof value==='string' && value.length<=128
  && /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(value);
const digest = (value:unknown):value is `sha256-${string}` => typeof value==='string' && /^sha256-[a-f0-9]{64}$/.test(value);
const objectVersion = (value:unknown):value is number|string => typeof value==='string'&&validId(value)
  || Number.isSafeInteger(value)&&Number(value)>=0;
const exact=(value:Record<string,unknown>,required:readonly string[],optional:readonly string[]=[])=>
  required.every(key=>Object.hasOwn(value,key))&&Object.keys(value).every(key=>required.includes(key)||optional.includes(key));
export type RenderExecution=Readonly<{moduleId:string;operationId:string;operationDigest:`sha256-${string}`;executionId:string}>;
function renderAllowed(widget:WidgetCatalogEntry,value:unknown,audience:WidgetAudience,
  authorizeRender?:(render:RenderExecution)=>boolean):value is RenderExecution {
  if(!object(value)||!exact(value,['moduleId','operationId','operationDigest','executionId'])
    ||!validId(value.moduleId)||!validId(value.operationId)||!digest(value.operationDigest)
    ||!validId(value.executionId))return false;
  const render=value as RenderExecution;
  return widget.renderTools.some(tool=>tool.operationModuleId===render.moduleId
    &&tool.operationId===render.operationId&&tool.operationDigest===render.operationDigest
    &&tool.audiences.includes(audience))&&(authorizeRender?.(render)??true);
}
function bounded(value:unknown):boolean {
  const walk=(node:unknown,depth:number):boolean=>depth<=WIDGET_SNAPSHOT_LIMITS.depth
    && (!node||typeof node!=='object'||Object.values(node).every(child=>walk(child,depth+1)));
  try{return walk(value,0)&&encoder.encode(JSON.stringify(value)).length<=WIDGET_SNAPSHOT_LIMITS.bytes;}
  catch{return false;}
}
function entry(catalog:CompiledWidgetCatalog,moduleId:string,widgetId:string,widgetVersion:string,
  audience:WidgetAudience):WidgetCatalogEntry|null {
  return catalog.widgets.find(w=>w.moduleId===moduleId&&w.widgetId===widgetId&&w.version===widgetVersion
    &&w.audiences.includes(audience))??null;
}
function validInstance(value:unknown,catalog:CompiledWidgetCatalog,validators:WidgetValidatorMap,
  audience:WidgetAudience,authorized:(entry:WidgetCatalogEntry)=>boolean,
  authorizeRender?:(render:RenderExecution)=>boolean):value is WidgetMessageInstanceV1 {
  if(!object(value)||!exact(value,['instanceId','instanceRevision','moduleId','widgetId','widgetVersion',
    'resourceUri','resourceDigest','state'],['objectRef','objectVersion','renderExecution'])
    ||!validId(value.instanceId)||!Number.isSafeInteger(value.instanceRevision)
    ||Number(value.instanceRevision)<1||!validId(value.moduleId)||!validId(value.widgetId)
    ||!version(value.widgetVersion)||typeof value.resourceUri!=='string'||!digest(value.resourceDigest)
    ||value.objectRef!==undefined&&!validId(value.objectRef)
    ||value.objectVersion!==undefined&&!objectVersion(value.objectVersion))return false;
  const widget=entry(catalog,value.moduleId,value.widgetId,value.widgetVersion,audience);
  if(!widget||!authorized(widget)||widget.resourceUri!==value.resourceUri||widget.resourceDigest!==value.resourceDigest
    ||value.renderExecution!==undefined&&!renderAllowed(widget,value.renderExecution,audience,authorizeRender))return false;
  const key=`${widget.moduleId}\u0000${widget.widgetId}\u0000${widget.version}` as const;
  return validators.get(key)?.state(value.state)===true;
}
/** The stored value is never trusted just because it came from D1. */
export function projectWidgetSnapshot(value:unknown,catalog:CompiledWidgetCatalog,validators:WidgetValidatorMap,
  audience:WidgetAudience,authorized:(entry:WidgetCatalogEntry)=>boolean,
  authorizeRender?:(render:RenderExecution)=>boolean):WidgetMessageContentV1|null {
  try {
    const captured=copyJson(value,WIDGET_SNAPSHOT_LIMITS.bytes);
    if(!object(captured)||!exact(captured,['kind','schemaVersion','instances'])
      ||captured.kind!=='creezio.widget-message'||captured.schemaVersion!==1
      ||!Array.isArray(captured.instances)||captured.instances.length<1
      ||captured.instances.length>WIDGET_SNAPSHOT_LIMITS.instances||!bounded(captured)
      ||!captured.instances.every(item=>validInstance(item,catalog,validators,audience,authorized,authorizeRender)))return null;
    return captured as unknown as WidgetMessageContentV1;
  } catch {return null;}
}
export type WidgetSnapshotSeed=Readonly<{moduleId:string;widgetId:string;widgetVersion:string;state:unknown;
  objectRef?:string;objectVersion?:number|string;
  renderExecution?:Readonly<{moduleId:string;operationId:string;operationDigest:`sha256-${string}`;executionId:string}>}>;
/** Trusted host creates every instance ID and pins the exact compiled resource. */
export function createWidgetSnapshot(seeds:readonly WidgetSnapshotSeed[],catalog:CompiledWidgetCatalog,
  validators:WidgetValidatorMap,audience:WidgetAudience,authorized:(entry:WidgetCatalogEntry)=>boolean,
  authorizeRender?:(render:RenderExecution)=>boolean):WidgetMessageContentV1 {
  if(!Array.isArray(seeds)||seeds.length<1||seeds.length>WIDGET_SNAPSHOT_LIMITS.instances)throw new TypeError('Invalid widget instances.');
  const instances=seeds.map(seed=>{
    if(!validId(seed.moduleId)||!validId(seed.widgetId)||!version(seed.widgetVersion)
      ||seed.objectRef!==undefined&&!validId(seed.objectRef)
      ||seed.objectVersion!==undefined&&!objectVersion(seed.objectVersion))throw new TypeError('Invalid widget seed.');
    const widget=entry(catalog,seed.moduleId,seed.widgetId,seed.widgetVersion,audience);
    if(!widget||!authorized(widget)||seed.renderExecution!==undefined
      &&!renderAllowed(widget,seed.renderExecution,audience,authorizeRender))throw new TypeError('Widget unavailable.');
    const key=`${widget.moduleId}\u0000${widget.widgetId}\u0000${widget.version}` as const;
    const state=copyJson(seed.state,WIDGET_SNAPSHOT_LIMITS.bytes);
    if(validators.get(key)?.state(state)!==true)throw new TypeError('Invalid widget state.');
    return {instanceId:crypto.randomUUID(),instanceRevision:1,moduleId:widget.moduleId,widgetId:widget.widgetId,
      widgetVersion:widget.version,resourceUri:widget.resourceUri,resourceDigest:widget.resourceDigest,state,
      ...(seed.objectRef===undefined?{}:{objectRef:seed.objectRef}),
      ...(seed.objectVersion===undefined?{}:{objectVersion:seed.objectVersion}),
      ...(seed.renderExecution===undefined?{}:{renderExecution:seed.renderExecution})};
  });
  const content={kind:'creezio.widget-message' as const,schemaVersion:1 as const,instances};
  if(!bounded(content))throw new TypeError('Widget snapshot exceeds budget.');
  return copyJson(content,WIDGET_SNAPSHOT_LIMITS.bytes) as unknown as WidgetMessageContentV1;
}
