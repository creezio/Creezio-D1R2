import {copyJson, validId} from '../data/input.ts';
// Runtime composition already bundles the same semver implementation used by manifest validation.
// @ts-expect-error semver has no local declaration in this workspace.
import semver from 'semver';
import type {CompiledWidgetCatalog, WidgetCatalogEntry, WidgetValidatorMap} from '../../sdk/widgets/catalog.ts';
import type {WidgetAudience, WidgetMessageContentV1, WidgetMessageInstanceV1} from '../../sdk/widgets/types.ts';
import {validWidgetMessageContent} from '../../sdk/widgets/validation.ts';

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
/** Same semantics as the build-validated manifest range; malformed values fail closed. */
export function compatibleWidgetVersion(range:string|undefined,oldVersion:string):boolean {
  return typeof range==='string'&&range.length>0&&range.length<=256
    &&semver.validRange(range)!==null&&semver.valid(oldVersion)!==null
    &&semver.satisfies(oldVersion,range);
}
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
/** History projection replaces only renderer metadata; the stored execution pointer is preserved verbatim. */
export function projectHistoricalWidgetSnapshot(value:unknown,catalog:CompiledWidgetCatalog,validators:WidgetValidatorMap,
  audience:WidgetAudience,authorized:(entry:WidgetCatalogEntry)=>boolean):WidgetMessageContentV1|null {
  const current=projectWidgetSnapshot(value,catalog,validators,audience,authorized);
  if(current)return current;
  try {
    const captured=copyJson(value,WIDGET_SNAPSHOT_LIMITS.bytes);
    if(!object(captured)||!exact(captured,['kind','schemaVersion','instances'])
      ||captured.kind!=='creezio.widget-message'||captured.schemaVersion!==1
      ||!Array.isArray(captured.instances)||captured.instances.length<1
      ||captured.instances.length>WIDGET_SNAPSHOT_LIMITS.instances||!bounded(captured))return null;
    const instances=captured.instances.map(raw=>{
      if(!object(raw)||!exact(raw,['instanceId','instanceRevision','moduleId','widgetId','widgetVersion',
        'resourceUri','resourceDigest','state'],['objectRef','objectVersion','renderExecution'])
        ||!validId(raw.instanceId)||!Number.isSafeInteger(raw.instanceRevision)||Number(raw.instanceRevision)<1
        ||!validId(raw.moduleId)||!validId(raw.widgetId)||!version(raw.widgetVersion)
        ||!digest(raw.resourceDigest)||raw.resourceUri!==`ui://creezio/${raw.moduleId}/${raw.widgetId}/${raw.widgetVersion}/${raw.resourceDigest}.html`
        ||raw.objectRef!==undefined&&!validId(raw.objectRef)
        ||raw.objectVersion!==undefined&&!objectVersion(raw.objectVersion))return null;
      const render=raw.renderExecution;
      if(render!==undefined&&(!object(render)||!exact(render,['moduleId','operationId','operationDigest','executionId'])
        ||!validId(render.moduleId)||!validId(render.operationId)
        ||!digest(render.operationDigest)||!validId(render.executionId)))return null;
      const candidates=catalog.widgets.filter(w=>w.moduleId===raw.moduleId&&w.widgetId===raw.widgetId
        &&w.audiences.includes(audience)&&compatibleWidgetVersion(w.compatibility,raw.widgetVersion as string));
      const widget=candidates.length===1?candidates[0]:null;
      if(!widget||!authorized(widget)||render!==undefined&&!widget.renderTools.some(tool=>tool.operationModuleId===render.moduleId
        &&tool.operationId===render.operationId&&tool.audiences.includes(audience)))return null;
      const key=`${widget.moduleId}\u0000${widget.widgetId}\u0000${widget.version}` as const;
      if(validators.get(key)?.state(raw.state)!==true)return null;
      return {...raw,widgetVersion:widget.version,resourceUri:widget.resourceUri,resourceDigest:widget.resourceDigest};
    });
    if(instances.some(item=>item===null))return null;
    const projected={kind:'creezio.widget-message',schemaVersion:1,instances};
    return validWidgetMessageContent(projected)?projected:null;
  } catch{return null;}
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
