import type {WorkspaceViewProps} from '@creezio/sdk/workspace/types';

export type Period='day'|'week'|'month'|'year';
export type Tab='overview'|'productivity'|'pages'|'clicks'|'users'|'logs';
export type Count={name:string;count:number};
export type Event={id:string;principalId:string;actorPrincipalId:string;
  type:'page_view'|'click'|'activity'|'error';actionId:string|null;surface:string;path:string|null;
  errorCode:string|null;reportedDurationMs:number|null;occurredAt:string;source:'reported'};
export type Bounds={period:Period;from:string;to:string};
export type Snapshot={period:Bounds;source:'reported';complete:boolean;scanned:number;nextCursor:string|null;
  totals:{events:number;pageViews:number;clicks:number;errors:number;reportedDurationMs:number};
  activePrincipals:number;timeline:Count[];hours:Count[];pages:Count[];clicks:Count[];users:Count[]};
export type EventPage={period:Bounds;items:Event[];nextCursor:string|null;complete:boolean;scanned:number};
export type ExportPage={format:'csv'|'json';content:string;nextCursor:string|null;complete:boolean;period:Bounds};
export type ExecutionDiagnostic={id:string;moduleId:string;operationId:string;audience:'admin'|'app';
  state:string;errorCode:string|null;createdAt:string;updatedAt:string;durationMs:number|null};
export type ExecutionDiagnosticsPage={period:Bounds;items:ExecutionDiagnostic[];nextCursor:string|null;complete:boolean};
export type EndpointDiagnostic={moduleId:string;operationId:string;audience:'admin'|'app';method:string;
  path:string;kind:'query'|'command'};
export type EndpointDiagnosticsPage={items:EndpointDiagnostic[];nextCursor:string|null;complete:boolean;
  source:'compiled-http-bindings'|'unavailable'};
export type CollectionPolicy={configured:boolean;revision:number;navigation:boolean;clicks:boolean;
  refusals:boolean;refusalRetentionDays:number;manualOnly:true};
export type RefusalItem={id:string;transport:'api'|'mcp';method:string;routeTemplate:string;
  status:number;errorCode:string;occurredAt:string;durationMs:number};
export type RefusalPage={items:RefusalItem[];nextCursor:string|null;complete:boolean};
export type RefusalPreview={revision:number;cutoff:string;items:{id:string;occurredAt:string}[];
  hasMore:boolean;manualOnly:true};
export type RefusalPurgeResult={deleted:number;hasMore:boolean;cutoff:string;revision:number};
export type RetentionPreview={configured:boolean;retentionDays:number|null;revision:number;
  manualOnly:true;cutoff:string|null;items:{id:string;occurredAt:string}[];hasMore:boolean};
export type RetentionPolicy=Pick<RetentionPreview,'configured'|'retentionDays'|'revision'|'manualOnly'>;
export type RetentionPurgeResult={deleted:number;hasMore:boolean;cutoff:string;revision:number};
export type Scope=Pick<WorkspaceViewProps,'client'|'access'|'audience'|'contextId'>;
export type Result<T>={kind:'ok';value:T}|{kind:'error';code:string};
export async function call<T>(scope:Scope,operation:string,input:Record<string,unknown>,isCurrent:()=>boolean):Promise<Result<T>>{
  const result=await scope.client.invoke({bindingId:`creezio.analytics:${scope.audience}.${operation}`,
    contextId:scope.contextId,input,isCurrent});
  if(result.kind==='rejected'||result.kind==='unknown')return {kind:'error',code:result.code};
  if(result.execution.state!=='succeeded')return {kind:'error',code:result.execution.errorCode??'unavailable'};
  return {kind:'ok',value:result.execution.output as T};
}
export function errorText(code:string){
  if(code==='forbidden'||code==='unauthorized')return 'Accès aux mesures refusé pour cette session.';
  if(code==='invalid_input')return 'Filtre ou curseur invalide. Réinitialisez la recherche.';
  return 'Mesures momentanément indisponibles. Réessayez.';
}
