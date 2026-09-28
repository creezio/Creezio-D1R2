import type {WorkspaceViewProps} from '@creezio/sdk/workspace/types';
import type {OperationClientResult} from '@creezio/sdk/operations/client';
import type {LandingSectionView,LandingSettingsView} from './types.ts';

export type Seo={title?:string;description?:string;canonical?:string};
export type PageSummary={id:string;slug:string;title:string;revision:number;publishedRevision:number;
  updatedAt:string;publishedAt:string|null};
export type DraftPage=PageSummary&{sections:LandingSectionView[];settings:LandingSettingsView;seo:Seo};
export type PublishedPage={id:string;slug:string;title:string;sections:LandingSectionView[];
  settings:LandingSettingsView;seo:Seo;publishedRevision:number;publishedAt:string};
export type PublishedPageSummary=Pick<PublishedPage,'id'|'slug'|'title'|'publishedRevision'|'publishedAt'>;
export type NavItem={id:string;label:string;href:string;icon:string;group:string;order:number;hidden:boolean};
export type Navigation={items:NavItem[];revision:number;publishedRevision:number;
  updatedAt:string|null;publishedAt:string|null};
export type PublishedNavigation={items:NavItem[];publishedRevision:number;publishedAt:string|null};
export type Media={pageId:string;fileId:string;filename:string;contentType:string;byteSize:number;
  reference:{fileId:string;intentId:string;generation:string;digest:string}};
export type PageResult<T>={items:T[];nextCursor:string|null};
export type Result<T>={kind:'ok';value:T}|{kind:'rejected'|'unknown';code:string};
export type Scope=Pick<WorkspaceViewProps,'client'|'access'|'audience'|'contextId'>;
export function operationResult<T>(result:OperationClientResult):Result<T>{
  if(result.kind==='rejected'||result.kind==='unknown')return {kind:result.kind,code:result.code};
  if(result.execution.state==='succeeded')return {kind:'ok',value:result.execution.output as T};
  if(result.execution.state==='failed')return {kind:'rejected',code:result.execution.errorCode??'unavailable'};
  return {kind:'unknown',code:result.execution.errorCode??'outcome_unknown'};
}
export async function call<T>(scope:Scope,operation:string,input:Record<string,unknown>,isCurrent:()=>boolean):Promise<Result<T>>{
  try{const result=await scope.client.invoke({bindingId:`creezio.pages-navigation:${scope.audience}.${operation}`,
    contextId:scope.contextId,input,isCurrent});
    return operationResult<T>(result);
  }catch{return {kind:'unknown',code:'outcome_unknown'};}
}
export function errorText(code:string):string{
  if(code==='forbidden'||code==='unauthorized')return 'Accès éditorial refusé. Actualisez votre session.';
  if(code==='conflict'||code==='stale')return 'La page a changé. Relisez-la avant de poursuivre.';
  if(code==='unknown'||code==='outcome_unknown')return 'Résultat incertain. Vérifiez l’état avant une nouvelle action.';
  return 'Opération indisponible. Actualisez avant de réessayer.';
}
export const requestKey=()=>crypto.randomUUID();
