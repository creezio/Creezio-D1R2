import type {DataPlan} from '../../core/data/types.ts';

/** Opaque storage reference; never a bucket key or an authorization token. */
export interface StagedFileReference {
  readonly fileId: string;
  readonly intentId: string;
  readonly generation: string;
  readonly digest: string;
}
export interface RemoteSourceProof { readonly connectionId:string; readonly configRevision:number }
export interface RemoteAttachmentMetadata { readonly id:string; readonly filename:string;
  readonly contentType:string; readonly byteSize:number }
export interface VerifiedStagedFile { readonly ref:StagedFileReference;
  readonly file:Readonly<Omit<RemoteAttachmentMetadata,'id'>> }

/** Host-owned publication capability. The returned plan must accompany the business link. */
export interface OperationFilesPort {
  /** Download one statically declared remote child into private staged storage. */
  stageRemote(categoryId:string,input:Readonly<{remoteId:string;parentId:string;childId:string;
    expected:Readonly<Omit<RemoteAttachmentMetadata,'id'>>;sourceProof:RemoteSourceProof;
    intentId:string;generation:string}>):Promise<VerifiedStagedFile>;
  /** Prepare one exact, atomic publication for zero to fifty staged references. */
  prepareBatchPublication(categoryId:string,input:Readonly<{remoteId:string;
    sourceProof:RemoteSourceProof;sourceModel:string;sourceScope:Readonly<Record<string,string>>;
    destinationModel:string;destinationScope:Readonly<Record<string,string>>;
    attachments:readonly Readonly<StagedFileReference & Omit<RemoteAttachmentMetadata,'id'>>[]}>):Promise<void>;
  /** Host-verified, atomic copy of private links between declared module models. */
  freezeLinks(categoryId:string,input:Readonly<{sourceModel:string;destinationModel:string;
    sourceScope:Readonly<Record<string,string>>;destinationScope:Readonly<Record<string,string>>;
    attachments:readonly Readonly<StagedFileReference & {
      filename:string;contentType:string;byteSize:number}>[]}>):Promise<void>;
  publicationProof(categoryId: string, reference: StagedFileReference): Promise<DataPlan>;
  preparePublication(categoryId: string, reference: StagedFileReference): Promise<{
    readonly plan: DataPlan;
    readonly file: {readonly fileId: string; readonly filename: string; readonly contentType: string; readonly byteSize: number};
  }>;
}
