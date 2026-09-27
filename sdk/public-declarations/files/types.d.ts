import type {DataPlan} from '@creezio/sdk/operations/handler';

/** Opaque reference, never a bucket key or authorization token. */
export interface StagedFileReference {
  readonly fileId:string;readonly intentId:string;readonly generation:string;readonly digest:string;
}
export interface OperationFilesPort {
  publicationProof(categoryId:string,reference:StagedFileReference):Promise<DataPlan>;
  preparePublication(categoryId:string,reference:StagedFileReference):Promise<{
    readonly plan:DataPlan;
    readonly file:{readonly fileId:string;readonly filename:string;readonly contentType:string;readonly byteSize:number};
  }>;
}
