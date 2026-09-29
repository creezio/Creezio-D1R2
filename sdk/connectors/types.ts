import type {JsonValue} from '@creezio/sdk/operations/handler';

/** Static module-owned mapping. An operation never supplies an outbound URL or header. */
export interface ConnectorConfigStorage {
  readonly moduleId:string;
  readonly modelId:string;
  readonly contextField:string;
  readonly fields:Readonly<{id:string;origin:string;keyRef:string;secretVersion:string;
    enabled:string;revision:string;updatedAt:string}>;
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
export interface ConnectorResource {
  readonly id:string;
  readonly method:'GET';
  readonly path:string;
  readonly params:readonly ConnectorParameter[];
  /** Provider names for declared inputs and fixed filters, never supplied by the operation. */
  readonly query?:Readonly<{cursor?:string;limit?:string;
    fixed?:readonly Readonly<{name:string;value:string}>[]}>;
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
  readonly resources:readonly ConnectorResource[];
}
export interface ConnectorRequest {
  readonly resource:string;
  readonly id?:string;
  readonly cursor?:string;
  readonly limit?:number;
  readonly signal?:AbortSignal;
}
export type ConnectorErrorCode='invalid_request'|'not_configured'|'access_denied'|'remote_auth'|
  'remote_not_found'|'remote_error'|'unavailable'|'invalid_response';
export type ConnectorResult=Readonly<{kind:'ok';status:200;body:JsonValue}>|
  Readonly<{kind:'error';code:ConnectorErrorCode;status?:number}>;
/** One bounded, read-only call per declared operation. Secret material stays in the host. */
export interface ConnectorPort {
  request(input:ConnectorRequest):Promise<ConnectorResult>;
}
