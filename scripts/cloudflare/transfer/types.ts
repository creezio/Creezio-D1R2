/** Operator-only T32 snapshot. No provider token or plaintext secret enters these records. */
export type TransferDigest = `sha256-${string}`;
export type ContentDigest = string; // exactly 64 lowercase hexadecimal characters at runtime

export interface TransferTarget {
  readonly accountId:string;
  readonly workerName:string;
  readonly databaseId:string;
  readonly bucketName:string;
  readonly origin:string;
}
export interface TransferIdentity {
  readonly transferId:string;
  readonly applicationId:string;
  readonly sourceSha:string;
  readonly compositionDigest:TransferDigest;
  readonly lockDigest:TransferDigest;
  readonly modelDigest:TransferDigest;
  readonly schemaObjectsDigest:TransferDigest;
  readonly planDigest:TransferDigest;
  readonly sourceSchemaReceiptId:TransferDigest;
  readonly target:TransferTarget;
}
export type SqlCell=null
  | Readonly<{type:'text';value:string}>
  | Readonly<{type:'integer'|'real';value:number}>
  | Readonly<{type:'blob';base64url:string}>;
export interface CapturedRow {
  readonly values:readonly SqlCell[];
}
export interface CapturedTable {
  readonly moduleId:string;
  readonly modelId:string;
  readonly table:string;
  readonly columns:readonly string[];
  readonly primaryKey:readonly string[];
  readonly policy:'copy'|'skip'|'transform';
  /** Source count before a native exclusion or transformation. */
  readonly sourceRowCount:number;
  readonly rowCount:number;
  readonly byteLength:number;
  readonly rowDigest:TransferDigest;
  /** Relative, flat file name. NDJSON rows in primary-key order; no SQL statements. */
  readonly dataFile:string|null;
}
export interface CapturedObject {
  readonly key:string;
  readonly size:number;
  readonly sha256:ContentDigest;
  readonly httpMetadata:Readonly<Record<string,string>>;
  readonly customMetadata:Readonly<Record<string,string>>;
  /** Relative file name whose bytes have been checked against sha256. */
  readonly bodyFile:string;
}
export interface CapturedObjectIndex {
  readonly count:number;
  /** Total bytes of object bodies. */
  readonly byteLength:number;
  readonly segments:readonly Readonly<{indexFile:string;indexDigest:TransferDigest;
    count:number;byteLength:number}>[];
}
export interface TransferManifest {
  readonly schemaVersion:1;
  readonly identity:TransferIdentity;
  readonly capturedAt:string;
  readonly policyDigest:TransferDigest;
  /** Preserved, non-replayable OpenAI turn uncertainty; zero for a quiescent snapshot. */
  readonly uncertainHistoryCount?:number;
  readonly tables:readonly CapturedTable[];
  readonly objects:CapturedObjectIndex;
  readonly manifestDigest:TransferDigest;
}
export interface TransferCapture {
  readonly manifest:TransferManifest;
  readonly directory:string;
  /** Already closed on success; safe to call repeatedly in finally blocks. */
  release():Promise<void>;
}
export interface SecretSelection {
  readonly contextId:string;
  readonly reference:string;
  readonly bindingId:string;
  readonly mode:'rewrap'|'disable';
}
export interface TransferCheckpoint {
  readonly schemaVersion:1;
  readonly revision:number;
  readonly identity:TransferIdentity;
  readonly manifestDigest:TransferDigest;
  readonly phase:'captured'|'schema-ready'|'d1-copying'|'r2-copying'|'secrets-ready'
    |'verified'|'delivery-unknown'|'delivered';
  /** One sequential cursor each; the target is inspected before moving either cursor. */
  readonly tableCursor:Readonly<{table:string;rowOffset:number}>|null;
  readonly objectCursor:Readonly<{key:string;ordinal:number}>|null;
  readonly multipart:Readonly<{key:string;uploadId:string;
    pendingPart?:Readonly<{number:number;size:number;sha256:ContentDigest;md5:string}>|null;
    completedParts:readonly Readonly<{number:number;etag:string;sha256:ContentDigest}>[]}>|null;
  readonly targetSchemaReceiptId:TransferDigest|null;
  readonly targetDeploymentId:string|null;
}
export interface TransferJournal {
  load(transferId:string):Promise<TransferCheckpoint|null>;
  create(checkpoint:TransferCheckpoint):Promise<void>;
  compareAndSave(previous:TransferCheckpoint,next:TransferCheckpoint):Promise<void>;
}
/** Remote adapter enforces conditional creation and checks full bytes, never ETag alone. */
export interface TransferObjectPort {
  inspectObject(entry:CapturedObject):Promise<'absent'|'matching'|'conflict'>;
  putObjectIfAbsent(entry:CapturedObject,bytes:AsyncIterable<Uint8Array>,checkpoint:TransferCheckpoint):
    Promise<'created'|'matching'|'unknown'>;
  listObjectKeys():AsyncIterable<string>;
}
