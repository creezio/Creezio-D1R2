import type {DataPlan} from '../data/types.ts';

export interface DeliveryMapping {
  readonly id:string;
  readonly moduleId:string;
  readonly commandId:string;
  readonly prepareId:string;
  readonly providerModuleId:string;
  readonly connectorId:string;
  readonly resourceId:string;
  readonly readinessId:string;
  readonly configRevisionField:string;
  readonly prepareInput:Readonly<Record<string,string>>;
  readonly matchFields:readonly string[];
  readonly envelopeField:string;
  readonly projectorInput:Readonly<Record<string,string>>;
  readonly acceptance:Readonly<{responseIdField:string;receiptIdField:string}>;
  readonly modelIds:readonly string[];
  readonly validateReceipt:(value:unknown)=>boolean;
  /** The compiled declaration fixes the module's input shape; the host constructs only mapped fields. */
  readonly projector:(input:any,scope:any)=>Promise<readonly DataPlan[]>|readonly DataPlan[];
}
