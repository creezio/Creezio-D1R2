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
  publicationProof(categoryId: string, reference: StagedFileReference): Promise<DataPlan>;
  preparePublication(categoryId: string, reference: StagedFileReference): Promise<{
    readonly plan: DataPlan;
    readonly file: {readonly fileId: string; readonly filename: string; readonly contentType: string; readonly byteSize: number};
  }>;
}
