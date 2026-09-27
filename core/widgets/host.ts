import type {CompiledWidgetCatalog, WidgetCatalogEntry, WidgetValidatorMap} from '../../sdk/widgets/catalog.ts';
import type {WidgetAudience, WidgetMessageContentV1,WidgetMessageInstanceV1} from '../../sdk/widgets/types.ts';
import {copyJson} from '../data/input.ts';
import type {JsonValue} from '../data/types.ts';
import {createWidgetSnapshot,projectWidgetSnapshot,type WidgetSnapshotSeed,type RenderExecution} from './snapshot.ts';

/** Trusted Conversations capability. It never exposes the catalog or its validators to an iframe. */
export interface WidgetOperationPort {
  createSnapshot(seeds:readonly WidgetSnapshotSeed[]):WidgetMessageContentV1;
  projectSnapshot(value:unknown):WidgetMessageContentV1|null;
  contextAction(instance:WidgetMessageInstanceV1,actionId:string,input:unknown):Readonly<{
    namespace:'module-instance';expiresAfterSeconds:number;value:JsonValue}>;
}
export function createWidgetOperationPort(options:{catalog:CompiledWidgetCatalog;validators:WidgetValidatorMap;
  audience:WidgetAudience;authorize:(entry:WidgetCatalogEntry)=>void;
  authorizeRender?:(render:RenderExecution)=>boolean}):WidgetOperationPort {
  const authorized=(entry:WidgetCatalogEntry)=>{
    try{options.authorize(entry);return true;}catch{return false;}
  };
  return Object.freeze({
    createSnapshot:(seeds:readonly WidgetSnapshotSeed[])=>createWidgetSnapshot(seeds,options.catalog,options.validators,
      options.audience,authorized,options.authorizeRender),
    projectSnapshot:(value:unknown)=>projectWidgetSnapshot(value,options.catalog,options.validators,
      options.audience,authorized,options.authorizeRender),
    contextAction(instance:WidgetMessageInstanceV1,actionId:string,input:unknown){
      const widget=options.catalog.widgets.find(item=>item.moduleId===instance.moduleId
        &&item.widgetId===instance.widgetId&&item.version===instance.widgetVersion
        &&item.resourceUri===instance.resourceUri&&item.resourceDigest===instance.resourceDigest
        &&item.audiences.includes(options.audience));
      if(!widget||!authorized(widget))throw new TypeError('Widget unavailable.');
      const action=widget.actions.find(item=>item.id===actionId);
      if(!action||action.mode!=='context'||action.target.namespace!=='module-instance')throw new TypeError('Context action unavailable.');
      const key=`${widget.moduleId}\u0000${widget.widgetId}\u0000${widget.version}` as const;
      const value=copyJson(input,4096);
      if(options.validators.get(key)?.actionInputs.get(actionId)?.(value)!==true)throw new TypeError('Invalid context input.');
      if(!value||typeof value!=='object'||Array.isArray(value)||action.target.fields.some(field=>!Object.hasOwn(value,field)))
        throw new TypeError('Invalid context fields.');
      const fields:Record<string,JsonValue>=Object.create(null);
      for(const field of action.target.fields)fields[field]=(value as Record<string,JsonValue>)[field];
      return Object.freeze({namespace:action.target.namespace,expiresAfterSeconds:action.target.expiresAfterSeconds,
        value:copyJson(fields,4096)});
    },
  });
}
