import type {DataPlan} from '../../core/data/types.ts';

/** Opaque storage reference; never a bucket key or an authorization token. */
export interface StagedFileReference {
  readonly fileId: string;
  readonly intentId: string;
  readonly generation: string;
  readonly digest: string;
}

/** Host-owned publication capability. The returned plan must accompany the business link. */
export interface OperationFilesPort {
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
