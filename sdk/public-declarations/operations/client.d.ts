import type {AccessAudience,AccessController} from '../access/types.js';
import type {JsonValue} from '@creezio/sdk/operations/handler';

export interface OperationHttpBinding {
  readonly id:string;readonly contributorModuleId:string;readonly moduleId:string;readonly operationId:string;
  readonly method:'GET'|'POST'|'PUT'|'PATCH'|'DELETE';readonly path:string;readonly audience:AccessAudience;
  readonly auth:readonly ('session'|'api-token'|'oauth'|'impersonation'|'anonymous'|'webhook-signature')[];
  readonly parameters:readonly {readonly name:string;readonly in:'path'|'query'|'header';readonly inputField:string;
    readonly required:boolean;readonly codec:'string'|'integer'|'number'|'boolean'}[];
  readonly inputSchemaId:string;readonly outputSchemaId:string;readonly context:'application'|'required';
  readonly kind:'query'|'command';readonly rateLimit:Readonly<{requests:number;windowSeconds:number}>;
  readonly contractDigest:string;
}
export interface OperationHttpExecution {
  readonly id:string;readonly state:'running'|'waiting'|'succeeded'|'failed'|'unknown';
  readonly output:JsonValue;readonly errorCode:string|null;readonly replayed?:boolean;
}
export type OperationClientResult=Readonly<{kind:'execution';execution:OperationHttpExecution}>
  |Readonly<{kind:'rejected';code:string;status:number}>
  |Readonly<{kind:'unknown';code:string;executionId?:string}>;
export interface OperationClientRequest {
  readonly bindingId:string;readonly contextId:string;readonly input:Readonly<Record<string,unknown>>;
  readonly approvalId?:string;readonly isCurrent?:()=>boolean;
}
export type OperationClientStatusRequest=Readonly<{bindingId:string;contextId:string;isCurrent?:()=>boolean}
  &({executionId:string;requestKey?:never}|{requestKey:string;executionId?:never})>;
export const OPERATION_CLIENT_LIMITS:Readonly<Record<string,number>>;
export function createOperationClient(options:{origin:string;audience:AccessAudience;access:AccessController;
  bindings:readonly OperationHttpBinding[];fetcher?:typeof fetch}):Readonly<{
    origin:string;audience:AccessAudience;
    invoke(request:OperationClientRequest):Promise<OperationClientResult>;
    status(request:OperationClientStatusRequest):Promise<OperationClientResult>;
  }>;
export type OperationClient=ReturnType<typeof createOperationClient>;
