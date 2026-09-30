import type {JsonValue} from '../operations/handler.ts';

/** A build-owned source. Modules cannot choose a model, field or permission at call time. */
export interface SearchProjectionSource {
  readonly id:string;
  readonly moduleId:string;
  readonly modelId:string;
  readonly permissionId:string;
  readonly projectionVersion:string;
  readonly orderIndexId:string;
  readonly idField:string;
  readonly revisionField:string;
  readonly visibilityField:string;
  readonly visibleValue:string;
  readonly fields:readonly string[];
  readonly facets:readonly string[];
}
/** The existing contracts.search shape, narrowed for a provider-backed projection. */
export interface ProviderSearchDeclaration {
  readonly id:string;
  readonly model:Readonly<{moduleId:string;kind:'model';id:string}>;
  readonly fields:readonly string[];
  readonly facets:readonly string[];
  readonly permissions:readonly Readonly<{moduleId:string;kind:'permission';id:string}>[];
  readonly context:'required';
  readonly engine:'provider';
  readonly provider:string;
  readonly projection:Readonly<{orderIndexId:string;idField:string;revisionField:string;
    visibilityField:string;visibleValue:string}>;
  readonly projectionVersion:string;
  readonly filterBeforeCount:true;
  readonly resumable:true;
}
export interface SearchProjectionItem {
  readonly id:string;
  readonly revision:number;
  readonly deleted:boolean;
  readonly fields?:Readonly<Record<string,JsonValue>>;
}
export interface SearchProjectionPage {
  readonly items:readonly SearchProjectionItem[];
  /** Resume token immediately after each item, for one bounded provider batch. */
  readonly afterEach:readonly string[];
  readonly nextCursor:string|null;
}
export interface SearchProjectionPort {
  /** IDs from active, build-selected search declarations for this provider. */
  sources():readonly string[];
  facets(source:string):readonly string[];
  indexUid(input:Readonly<{source:string;epoch:string}>):Promise<string>;
  /** A fresh, context-bound page, including tombstones for no-longer-visible records. */
  page(input:Readonly<{source:string;cursor?:string;limit:number}>):Promise<SearchProjectionPage>;
  /** Re-read provider hits from their owner model before returning data. */
  reauthorize(input:Readonly<{source:string;ids:readonly string[]}>):Promise<readonly SearchProjectionItem[]>;
}
