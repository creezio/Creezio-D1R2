import type {JsonValue} from '@creezio/sdk/operations/handler';

/** Static module-owned mapping. An operation never supplies an outbound URL or header. */
export interface ConnectorConfigStorage {
  readonly moduleId:string;
  readonly modelId:string;
  readonly contextField:string;
  readonly fields:Readonly<{id:string;origin:string;keyRef:string;secretVersion:string;
    enabled:string;revision:string;updatedAt:string;connectionId?:string}>;
}
/** Public structural shape accepted by the trusted vault implementation. */
export interface ConnectorVaultStorage {
  readonly moduleId:string;
  readonly modelId:string;
  readonly contextField:string;
  readonly fields:Readonly<{id:string;bindingId:string;ciphertext:string;keyId:string;
    version:string;state:string}>;
}
export type ConnectorParameter='id'|'cursor'|'limit';
export interface ConnectorBodyField {
  /** Handler name and fixed provider name; a handler cannot add fields at call time. */
  readonly name:string;
  readonly wireName:string;
  readonly kind:'string'|'integer'|'boolean'|'json';
  readonly required?:boolean;
  readonly maxBytes:number;
}
export interface ConnectorResource {
  readonly id:string;
  readonly method:'GET'|'POST'|'PUT'|'PATCH'|'DELETE';
  readonly path:string;
  readonly params:readonly ConnectorParameter[];
  /** Provider names for declared inputs and fixed filters, never supplied by the operation. */
  readonly query?:Readonly<{cursor?:string;limit?:string;
    fixed?:readonly Readonly<{name:string;value:string}>[];
    fields?:readonly ConnectorBodyField[]}>;
  /** A write can only send declared fields using the declared encoding. */
  readonly body?:Readonly<{encoding:'form'|'json'|'json-root';fields:readonly ConnectorBodyField[];
    fixed?:readonly Readonly<{name:string;value:string}>[]}>;
  /** Host-only binary insertion into a declared JSON request; handlers cannot supply it. */
  readonly attachments?:Readonly<{wireName:string;maxItems:number;maxBytes:number}>;
  /** Optional provider replay guard, for example Stripe's Idempotency-Key. */
  readonly idempotencyHeader?:string;
  readonly successStatuses?:readonly number[];
  readonly responseBody?:'json'|'none';
}
/** Static host policy for one private attachment download. */
export interface ConnectorBinaryDownload {
  readonly id:string;
  readonly proofOperationId:string;
  readonly metadataPath:string;
  readonly cdnOrigin:string;
  readonly cdnPath:string;
  readonly maxBytes:number;
  readonly event:Readonly<{modelId:string;indexId:string;connectionField:string;
    parentField:string;typeField:string;typeValue:string}>;
}
export interface ConnectorDescriptor {
  readonly id:string;
  readonly moduleId:string;
  readonly config:ConnectorConfigStorage;
  readonly vault:ConnectorVaultStorage;
  readonly auth:Readonly<{kind:'api-key-header';name:string}|{kind:'bearer'}>;
  /** Optional canonical HTTPS origin required in addition to the stored configuration. */
  readonly fixedOrigin?:string;
  /** Non-credential protocol headers fixed by the module contract. */
  readonly staticHeaders?:readonly Readonly<{name:string;value:string}>[];
  /** Optional test credential constraint for outbound mutations. */
  readonly mutationSecretPrefix?:string;
  /** Build-selected signed ingress, resolved by the host from context-scoped vault references. */
  readonly webhook?:Readonly<{path:string;operationId:string;scheme:'stripe'|'standard'|'resend';
    mapper:Readonly<{path:string;export:string}>;
    fields:Readonly<{connectionId:string;signingRef:string;signingVersion:string;
      previousRef:string;previousVersion:string;serviceTokenRef:string;serviceTokenVersion:string}>}>;
  readonly resources:readonly ConnectorResource[];
  readonly binaryDownloads?:readonly ConnectorBinaryDownload[];
}
export interface ConnectorRequest {
  readonly resource:string;
  readonly id?:string;
  readonly cursor?:string;
  readonly limit?:number;
  readonly fields?:Readonly<Record<string,JsonValue>>;
  readonly signal?:AbortSignal;
  /** Binds a prior signed-event proof to the configuration used by this GET. */
  readonly sourceProof?:Readonly<{connectionId:string;configRevision:number}>;
}
export interface ConnectorMutationRequest {
  readonly resource:string;
  readonly id?:string;
  readonly fields:Readonly<Record<string,JsonValue>>;
  readonly attachments?:readonly Readonly<{filename:string;contentType:string;bytes:Uint8Array}>[];
  readonly signal?:AbortSignal;
}
export type ConnectorErrorCode='invalid_request'|'not_configured'|'access_denied'|'remote_auth'|
  'remote_not_found'|'remote_error'|'unavailable'|'invalid_response'|'outcome_unknown';
export type ConnectorResult=Readonly<{kind:'ok';status:number;body:JsonValue}>|
  Readonly<{kind:'error';code:ConnectorErrorCode;status?:number}>;
/** One bounded call per declared operation. Secret material stays in the host. */
export interface ConnectorPort {
  request(input:ConnectorRequest):Promise<ConnectorResult>;
  mutate(input:ConnectorMutationRequest):Promise<ConnectorResult>;
}
