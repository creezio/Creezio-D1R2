import { readFileSync, readdirSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { inspectJson } from './load.mjs';
import { checkSchemaReferences, walk } from './references.mjs';
import { checkModule, checkComposition, contractIntegrity, canonicalJson } from './semantics.mjs';

export { contractIntegrity, canonicalJson } from './semantics.mjs';
const schemaDirectory = new URL('./schemas/v1/', import.meta.url);
const ajv = new Ajv2020({ strict:true, strictRequired:true, allErrors:true, ownProperties:true });
addFormats(ajv);
for (const name of readdirSync(schemaDirectory).filter(name=>name.endsWith('.schema.json')).sort()) ajv.addSchema(JSON.parse(readFileSync(new URL(name,schemaDirectory),'utf8')));
const validators = Object.fromEntries(['module','composition','composition-lock','artifact-receipt'].map(name=>[name,ajv.getSchema(`urn:creezio:contracts:v1:${name}`)]));
const schemaCache = new Map();
const MAX_ERRORS = 128;

function context() {
  const errors=[];
  return { errors, report:(code,path,message)=>{ if(errors.length<MAX_ERRORS) errors.push({code,path,message}); } };
}
function shape(name, value, ctx, prefix='') {
  const inspected=inspectJson(value);
  for(const error of inspected.errors) ctx.report(error.code,prefix+error.path,error.message);
  if(inspected.errors.length)return false;
  if(validators[name](value))return true;
  for(const error of validators[name].errors??[]) ctx.report('schema.invalid',prefix+error.instancePath,`${name}: ${error.message}`);
  return false;
}
function embeddedSchemas(module,ctx) {
  let compiler;
  for(const [i,item] of module.contracts.schemas.entries()) {
    const location=`/contracts/schemas/${i}/schema`, before=ctx.errors.length;
    const inspected=inspectJson(item.schema,{maxDepth:32,maxNodes:4000,maxBytes:256*1024});
    for(const error of inspected.errors)ctx.report(error.code,location+error.path,error.message);
    if(inspected.errors.length)continue;
    checkSchemaReferences(item.schema,location,ctx.report);
    walk(item.schema,(node,path)=>{if(node&&typeof node==='object'&&typeof node.pattern==='string'&&node.pattern.length>1024)ctx.report('schema.pattern',location+path,'Schema pattern exceeds its compilation bound.');});
    if(ctx.errors.length!==before)continue;
    const hash=contractIntegrity(item.schema);
    if(schemaCache.has(hash)) { if(schemaCache.get(hash))ctx.report('schema.invalid',location,schemaCache.get(hash)); continue; }
    let failure=null;
    try {
      compiler ??= addFormats(new Ajv2020({strict:true,strictRequired:true,ownProperties:true,inlineRefs:false,loopRequired:100,loopEnum:100,code:{optimize:0}}));
      if(!compiler.validateSchema(item.schema)) failure='Embedded JSON Schema is not meta-valid.';
      else { compiler.compile(item.schema); compiler.removeSchema(item.schema); }
    } catch { failure='Embedded JSON Schema is not supported by the strict 2020-12 compiler.'; }
    if(schemaCache.size>=128)schemaCache.delete(schemaCache.keys().next().value);
    schemaCache.set(hash,failure);
    if(failure)ctx.report('schema.invalid',location,failure);
  }
}

/** Pure validation of supplied declarations. It neither reads package files nor executes their handlers or test scripts. */
export function validateArtifactReceipt(receipt) {
  const ctx=context(),metrics={scope:'supplied-contracts-only'};
  shape('artifact-receipt',receipt,ctx);
  return {errors:ctx.errors,metrics};
}

export function validateModule(module) {
  const ctx=context(),metrics={scope:'supplied-contracts-only',moduleCount:0,schemaCount:0,operationCount:0,widgetCount:0,references:0};
  if(!shape('module',module,ctx))return {errors:ctx.errors,metrics};
  metrics.moduleCount=1; metrics.schemaCount=module.contracts.schemas.length; metrics.operationCount=module.contracts.operations.length; metrics.widgetCount=module.contracts.widgets.length;
  embeddedSchemas(module,ctx);
  const result=checkModule(module,ctx.report); metrics.references=result.references.length;
  return {errors:ctx.errors,metrics};
}

/** Resolve one closed composition. options.modules contains inert descriptors; options.lock is mandatory. */
export function validateComposition(composition, options={}) {
  const ctx=context(),metrics={scope:'supplied-contracts-only',moduleCount:0};
  const compositionValid=shape('composition',composition,ctx);
  const lockValid=options.lock === undefined ? (ctx.report('lock.missing','/lock','A composition lock is required.'),false) : shape('composition-lock',options.lock,ctx,'/lock');
  // Inspect the closed set as one inert value. Several individually valid modules can
  // exceed the single-document node budget; keep a separate bounded aggregate budget.
  const inspected=inspectJson(options.modules,{maxNodes:100000});
  if(inspected.errors.length || !Array.isArray(options.modules)) { ctx.report('composition.modules','/descriptors','An explicit bounded list of module descriptors is required.'); return {errors:ctx.errors,metrics}; }
  let modulesValid=true;
  options.modules.forEach((module,i)=>{
    const result=validateModule(module);
    for(const error of result.errors)ctx.report(error.code,`/descriptors/${i}${error.path}`,error.message);
    if(result.errors.length)modulesValid=false;
  });
  if(compositionValid&&lockValid&&modulesValid)Object.assign(metrics,checkComposition(composition,options.modules,options.lock,ctx.report));
  return {errors:ctx.errors,metrics};
}

/** Static change analysis only. A valid transition is not an authorization or a completed installation/deployment. */
export function validateCompositionTransition(before, after, options={}) {
  const ctx=context(),previous=validateComposition(before,options.before??{}),candidate=validateComposition(after,options.after??{});
  for(const [prefix,result] of [['/before',previous],['/after',candidate]])for(const error of result.errors)ctx.report(error.code,prefix+error.path,error.message);
  const metrics={scope:'supplied-contracts-only',changes:[],runtimeChanged:false};
  if(previous.errors.length || candidate.errors.length)return {errors:ctx.errors,metrics};
  if(before.application.id!==after.application.id)ctx.report('transition.application','/after/application/id','A transition cannot replace the application identity.');
  const oldSelection=new Map(before.modules.map(module=>[module.moduleId,module])),oldLock=new Map(options.before.lock.modules.map(module=>[module.moduleId,module]));
  const newSelection=new Map(after.modules.map(module=>[module.moduleId,module])),newLock=new Map(options.after.lock.modules.map(module=>[module.moduleId,module]));
  for(const [id,selection] of oldSelection) {
    const next=newSelection.get(id);
    if(next && selection.origin!==next.origin)ctx.report('transition.origin',`/after/modules/${id}`,'Replacing a module origin requires a separate explicit adoption contract.');
    const previousNode=oldLock.get(id),nextNode=newLock.get(id);
    const rebuilt=nextNode&&(previousNode.contractIntegrity!==nextNode.contractIntegrity||previousNode.runtime.integrity!==nextNode.runtime.integrity||previousNode.validation.integrity!==nextNode.validation.integrity||canonicalJson(previousNode.source)!==canonicalJson(nextNode.source));
    if(nextNode&&selection.source.kind==='package'&&previousNode.version===nextNode.version&&rebuilt)ctx.report('transition.immutable',`/after/modules/${id}`,'A versioned package cannot change its source, contract or artifact bytes without a new version.');
    const changes=[];
    if(!next)changes.push('remove');
    else {
      if(selection.enabled!==next.enabled)changes.push(next.enabled?'enable':'disable');
      if(previousNode.version!==nextNode.version)changes.push('update'); else if(rebuilt)changes.push('rebuild');
      if(canonicalJson(selection.integrations)!==canonicalJson(next.integrations))changes.push('integration');
      if(canonicalJson(selection.configuration)!==canonicalJson(next.configuration))changes.push('configure');
      if(canonicalJson(selection.source)!==canonicalJson(next.source))changes.push('source');
    }
    for(const action of changes)metrics.changes.push({moduleId:id,action});
  }
  for(const id of newSelection.keys())if(!oldSelection.has(id))metrics.changes.push({moduleId:id,action:'add'});
  return {errors:ctx.errors,metrics};
}
