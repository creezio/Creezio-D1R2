import type {WorkspaceViewProps} from '@creezio/sdk/workspace/types';
import type {OperationClientResult} from '@creezio/sdk/operations/client';

export type Attribute={key:string;value:string};
export type Status='draft'|'published'|'archived';
export type Product={id:string;sku:string;name:string;description:string;attributes:Attribute[];
  categoryId:string|null;priceMinor:number;currency:string;status:Status;revision:number;
  createdAt:string;updatedAt:string};
export type ProductSummary=Pick<Product,'id'|'sku'|'name'|'categoryId'|'priceMinor'|'currency'|
  'status'|'revision'|'updatedAt'>;
export type Category={id:string;name:string;slug:string;parentId:string|null;position:number;
  archivedAt:string|null;revision:number;createdAt:string;updatedAt:string};
export type Media={productId:string;fileId:string;filename:string;contentType:string;byteSize:number;
  digest:string;createdAt:string;reference:{fileId:string;intentId:string;generation:string;digest:string}};
export type Page<T>={items:T[];nextCursor:string|null;complete:boolean;scanned:number};
export type Result<T>={kind:'ok';value:T}|{kind:'error';code:string};
export type Scope=Pick<WorkspaceViewProps,'client'|'access'|'audience'|'contextId'>;
export function operationResult<T>(result:OperationClientResult):Result<T>{
  if(result.kind==='rejected'||result.kind==='unknown')return {kind:'error',code:result.code};
  if(result.execution.state==='succeeded')return {kind:'ok',value:result.execution.output as T};
  return {kind:'error',code:result.execution.errorCode??'outcome_unknown'};
}
export async function call<T>(scope:Scope,operation:string,input:Record<string,unknown>,isCurrent:()=>boolean):Promise<Result<T>>{
  try{const result=await scope.client.invoke({bindingId:`creezio.catalog:${scope.audience}.${operation}`,
    contextId:scope.contextId,input,isCurrent});
    return operationResult<T>(result);
  }catch{return {kind:'error',code:'outcome_unknown'};}
}
export const requestKey=()=>crypto.randomUUID();
export function errorText(code:string){
  if(code==='conflict')return 'Le produit ou la catégorie a changé. Relisez avant de modifier.';
  if(code==='forbidden'||code==='unauthorized')return 'Accès au catalogue refusé.';
  if(code==='not_found')return 'Produit ou catégorie introuvable.';
  if(code==='invalid_input')return 'Les champs ou filtres ne respectent pas le contrat du catalogue.';
  if(code==='client_state_unavailable')return 'État du panneau indisponible. Aucune modification envoyée.';
  if(code==='in_progress'||code==='outcome_unknown'||code==='stale')
    return 'Résultat incertain. Vérifiez l’action en attente avant toute nouvelle modification.';
  return 'Opération indisponible. Vérifiez le résultat avant de réessayer.';
}
