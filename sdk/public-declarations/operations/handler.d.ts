/** Public, plan-only authoring contract. Host credentials, SQL and private stores stay outside module code. */
export { OperationError } from '@creezio/sdk/operations/error';
export type { OperationErrorCode } from '@creezio/sdk/operations/error';
export type { StagedFileReference, OperationFilesPort } from '@creezio/sdk/files/types';
export type JsonValue = null | boolean | number | string | readonly JsonValue[] | {readonly [key:string]:JsonValue};
export interface DataPlan { readonly kind:'data-plan' }
export interface ContractReference { readonly moduleId:string; readonly kind:string; readonly id:string }
export interface DataField {
  readonly id:string; readonly type:'string'|'integer'|'number'|'boolean'|'date-time'|'json';
  readonly nullable:boolean; readonly protected:boolean; readonly computed:boolean;
  readonly default?:JsonValue; readonly schema?:{readonly schemaId:string};
  readonly constraints?:{readonly minLength?:number;readonly maxLength?:number;readonly minimum?:number;
    readonly maximum?:number;readonly enum?:readonly JsonValue[];readonly pattern?:string};
}
export interface DataModel {
  readonly id:string;readonly title:string;readonly scope:'context'|'application';readonly contextField?:string;
  readonly fields:readonly DataField[];readonly primaryKey:readonly string[];
  readonly indexes:readonly {readonly id:string;readonly fields:readonly string[];readonly unique:boolean}[];
  readonly relations:readonly {readonly id:string;readonly fields:readonly string[];readonly target:ContractReference;
    readonly targetFields:readonly string[];readonly onDelete:string}[];
  readonly permissions:readonly ContractReference[];
  readonly deletion:{readonly mode:'soft'|'hard';readonly requiresApproval:boolean};readonly public:boolean;
}
export type DataRecord = Readonly<Record<string,JsonValue>>;
export interface DataRead {readonly key:DataRecord;readonly fields?:readonly string[];readonly where?:DataRecord;readonly required?:boolean}
export interface DataList {readonly limit:number;readonly after?:DataRecord|null;readonly where?:DataRecord;readonly fields?:readonly string[];
  readonly order?:{readonly indexId:string;readonly direction:'asc'|'desc'}}
export interface DataCreate {readonly values:DataRecord}
export interface DataCompare {readonly field:string;readonly expected:number}
export interface DataPatch {readonly key:DataRecord;readonly values:DataRecord;readonly compare?:DataCompare;readonly where?:DataRecord}
export interface DataDelete {readonly key:DataRecord;readonly compare?:DataCompare;readonly where?:DataRecord}
export interface OperationDataPort {
  get(modelId:string,input:DataRead):Promise<DataRecord|null>;
  list(modelId:string,input:DataList):Promise<{readonly items:readonly DataRecord[];readonly nextAfter:DataRecord|null}>;
  planGet(modelId:string,input:DataRead):DataPlan;
  planList(modelId:string,input:DataList):DataPlan;
  planCreate(modelId:string,input:DataCreate):DataPlan;
  planPatch(modelId:string,input:DataPatch):DataPlan;
  planDelete(modelId:string,input:DataDelete):DataPlan;
}
/** Plan-only vault capability for a declared connector key configuration command. */
export interface ProviderSecretsPort {
  preparePut(input:Readonly<{providerId:string;secret:string}>):Promise<Readonly<{plan:DataPlan;reference:string;version:number}>>;
  prepareReplace(input:Readonly<{providerId:string;reference:string;expectedVersion:number;secret:string}>):
    Promise<Readonly<{plan:DataPlan;reference:string;version:number}>>;
  prepareRevoke(input:Readonly<{providerId:string;reference:string;expectedVersion:number}>):
    Promise<Readonly<{plan:DataPlan;version:number}>>;
}
import type {OperationFilesPort} from '@creezio/sdk/files/types';
import type {ConnectorPort} from '@creezio/sdk/connectors/types';
export interface OperationContext {
  readonly moduleId:string;readonly operationId:string;readonly executionId:string;
  readonly contextId:string;readonly audience:'admin'|'app';
  readonly principalId:string;readonly actorPrincipalId:string;readonly signal:AbortSignal;
  readonly data:OperationDataPort;readonly files?:OperationFilesPort;readonly connector?:ConnectorPort;
  readonly providerSecrets?:ProviderSecretsPort;
}
export interface OperationHandlerResult {readonly output:unknown;readonly plans?:readonly DataPlan[]}
export type OperationHandler=(input:JsonValue,context:OperationContext)=>OperationHandlerResult|Promise<OperationHandlerResult>;
