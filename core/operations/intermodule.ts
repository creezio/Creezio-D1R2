import {copyJson} from '../data/input.ts';
import {OperationError, OPERATION_LIMITS, type RegisteredOperation} from './types.ts';
import type {OperationRegistry} from './registry.ts';
import type {JsonValue} from '../data/types.ts';

/** Host-private traversal state. Modules cannot set an identity, context or traversal budget. */
export interface QueryTraversal {
  readonly path: readonly string[];
  readonly budget: {remaining: number};
}
export const INTERMODULE_LIMITS = Object.freeze({depth: 4, calls: 16});
export const queryTraversal = (operation: RegisteredOperation): QueryTraversal => ({
  path: Object.freeze([`${operation.moduleId}:${operation.declaration.id}`]),
  budget: {remaining: INTERMODULE_LIMITS.calls},
});

export interface ModuleQueryRequest {readonly moduleId:string; readonly operationId:string; readonly input:JsonValue}
export interface ModuleQueryPort {query(request:ModuleQueryRequest):Promise<JsonValue>}
const isObject=(value:JsonValue):value is Readonly<Record<string,JsonValue>>=>
  value!==null&&typeof value==='object'&&!Array.isArray(value);

/** Declarations are already linked to consumed, versioned public contracts by the composition compiler. */
export function createModuleQueryPort(options: {
  readonly source:RegisteredOperation;
  readonly registry:OperationRegistry;
  readonly traversal:QueryTraversal;
  readonly ensureActive:()=>void;
  readonly spend:()=>void;
  readonly invoke:(request:ModuleQueryRequest, traversal:QueryTraversal)=>Promise<JsonValue>;
}):ModuleQueryPort {
  return Object.freeze({async query(supplied:ModuleQueryRequest):Promise<JsonValue> {
    options.ensureActive();
    let raw:JsonValue;
    try{raw=copyJson(supplied,OPERATION_LIMITS.inputBytes+1024);}
    catch{throw new OperationError('invalid_input');}
    if(!isObject(raw)
      ||Object.keys(raw).length!==3||!Object.hasOwn(raw,'input')
      ||typeof raw.moduleId!=='string'||typeof raw.operationId!=='string')throw new OperationError('invalid_input');
    const {moduleId,operationId,input}=raw;
    if(!options.source.declaration.effects.calls.some(ref=>ref.kind==='operation'
      &&ref.moduleId===moduleId&&ref.id===operationId))throw new OperationError('forbidden');
    const target=options.registry.resolve(moduleId,operationId), declaration=target.declaration;
    // Nested mutations cannot share an atomic commit with their caller; this port never exposes them.
    if(declaration.public!==true||declaration.kind!=='query'||declaration.effects.writes.length
      ||declaration.effects.emits.length||declaration.approval.mode!=='none')throw new OperationError('forbidden');
    const key=`${moduleId}:${operationId}`;
    if(options.traversal.path.includes(key)||options.traversal.path.length>=INTERMODULE_LIMITS.depth
      ||options.traversal.budget.remaining<=0)throw new OperationError('rate_limited');
    options.spend();
    options.traversal.budget.remaining--;
    const next={path:Object.freeze([...options.traversal.path,key]),budget:options.traversal.budget};
    const output=await options.invoke({moduleId,operationId,input},next);
    options.ensureActive();
    return copyJson(output,OPERATION_LIMITS.outputBytes);
  }});
}
