import type {CompiledWidgetCatalog, WidgetCatalogEntry, WidgetValidatorMap} from '../../sdk/widgets/catalog.ts';
import type {WidgetAudience, WidgetMessageContentV1,WidgetMessageInstanceV1} from '../../sdk/widgets/types.ts';
import {copyJson} from '../data/input.ts';
import type {JsonValue} from '../data/types.ts';
import {createWidgetSnapshot,projectWidgetSnapshot,projectHistoricalWidgetSnapshot,
  type WidgetSnapshotSeed,type RenderExecution} from './snapshot.ts';

/** Trusted Conversations capability. It never exposes the catalog or its validators to an iframe. */
export interface WidgetOperationPort {
  createSnapshot(seeds:readonly WidgetSnapshotSeed[]):WidgetMessageContentV1;
  projectSnapshot(value:unknown):WidgetMessageContentV1|null;
  projectHistory(value:unknown):WidgetMessageContentV1|null;
  readHistory(value:unknown,instanceId:string):Promise<Readonly<{output:JsonValue}>|null>;
  contextActionAvailable(instance:WidgetMessageInstanceV1,actionId:string):boolean;
  contextValue(instance:WidgetMessageInstanceV1,actionId:string,value:unknown):JsonValue|null;
  contextAction(instance:WidgetMessageInstanceV1,actionId:string,input:unknown):Readonly<{
    namespace:'module-instance';expiresAfterSeconds:number;value:JsonValue}>;
}
export function createWidgetOperationPort(options:{catalog:CompiledWidgetCatalog;validators:WidgetValidatorMap;
  audience:WidgetAudience;authorize:(entry:WidgetCatalogEntry)=>void;
  authorizeRender?:(render:RenderExecution)=>boolean;
  readHistoricalRender?:(render:RenderExecution,widget:WidgetCatalogEntry)=>Promise<Readonly<{output:JsonValue}>|null>}):WidgetOperationPort {
  const authorized=(entry:WidgetCatalogEntry)=>{
    try{options.authorize(entry);return true;}catch{return false;}
  };
  return Object.freeze({
    createSnapshot:(seeds:readonly WidgetSnapshotSeed[])=>createWidgetSnapshot(seeds,options.catalog,options.validators,
      options.audience,authorized,options.authorizeRender),
    projectSnapshot:(value:unknown)=>projectWidgetSnapshot(value,options.catalog,options.validators,
      options.audience,authorized,options.authorizeRender),
    projectHistory:(value:unknown)=>projectHistoricalWidgetSnapshot(value,options.catalog,options.validators,
      options.audience,authorized),
    async readHistory(value:unknown,instanceId:string){
      if(!options.readHistoricalRender||typeof instanceId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(instanceId))return null;
      const projected=projectHistoricalWidgetSnapshot(value,options.catalog,options.validators,options.audience,authorized);
      const instance=projected?.instances.find(item=>item.instanceId===instanceId);
      if(!instance?.renderExecution)return null;
      const widget=options.catalog.widgets.find(item=>item.moduleId===instance.moduleId
        &&item.widgetId===instance.widgetId&&item.version===instance.widgetVersion
        &&item.resourceUri===instance.resourceUri&&item.resourceDigest===instance.resourceDigest);
      const render=instance.renderExecution;
      if(!widget||!widget.renderTools.some(tool=>tool.operationModuleId===render.moduleId
        &&tool.operationId===render.operationId&&tool.audiences.includes(options.audience)))return null;
      const output=await options.readHistoricalRender(render,widget);
      if(output===null)return null;
      // Leave room for the standard operation envelope and bounded instance id.
      const limit=Math.min(widget.transport.maxPayloadBytes,240_000);
      try{
        const copied=copyJson(output.output,limit);
        const key=`${widget.moduleId}\u0000${widget.widgetId}\u0000${widget.version}` as const;
        return options.validators.get(key)?.input(copied)===true?{output:copied}:null;
      }catch{return null;}
    },
    contextActionAvailable(instance:WidgetMessageInstanceV1,actionId:string){
      const widget=options.catalog.widgets.find(item=>item.moduleId===instance.moduleId
        &&item.widgetId===instance.widgetId&&item.version===instance.widgetVersion
        &&item.resourceUri===instance.resourceUri&&item.resourceDigest===instance.resourceDigest
        &&item.audiences.includes(options.audience));
      if(!widget||!authorized(widget))return false;
      const action=widget.actions.find(item=>item.id===actionId);
      if(!action||action.mode!=='context'||action.target.namespace!=='module-instance')return false;
      const key=`${widget.moduleId}\u0000${widget.widgetId}\u0000${widget.version}` as const;
      const validators=options.validators.get(key);
      return validators?.actionInputs.has(actionId)===true
        &&validators.contextValues?.has(actionId)===true;
    },
    contextValue(instance:WidgetMessageInstanceV1,actionId:string,input:unknown){
      const widget=options.catalog.widgets.find(item=>item.moduleId===instance.moduleId
        &&item.widgetId===instance.widgetId&&item.version===instance.widgetVersion
        &&item.resourceUri===instance.resourceUri&&item.resourceDigest===instance.resourceDigest
        &&item.audiences.includes(options.audience));
      if(!widget||!authorized(widget))return null;
      const action=widget.actions.find(item=>item.id===actionId);
      if(!action||action.mode!=='context'||action.target.namespace!=='module-instance')return null;
      try{
        const value=copyJson(input,4096);
        if(!value||typeof value!=='object'||Array.isArray(value)
          ||Object.keys(value).length!==action.target.fields.length
          ||action.target.fields.some(field=>!Object.hasOwn(value,field)))return null;
        const key=`${widget.moduleId}\u0000${widget.widgetId}\u0000${widget.version}` as const;
        return options.validators.get(key)?.contextValues?.get(actionId)?.(value)===true?value:null;
      }catch{return null;}
    },
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
