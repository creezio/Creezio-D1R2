/** Build-owned workspace navigation metadata. Module code receives a read-only projection. */
export interface WorkspaceNavigationEntryV1 {
  readonly id:string;
  readonly moduleId:string;
  readonly viewId:string;
  readonly title:string;
  readonly order:number;
  readonly route:string;
  readonly audiences:readonly ('admin'|'app')[];
  readonly permissionIds:readonly string[];
}
export interface WorkspaceNavigationCatalogV1 {
  readonly compositionDigest:string;
  readonly entries:readonly WorkspaceNavigationEntryV1[];
}
export interface WorkspaceNavigationProjectionV1 {
  readonly compositionDigest:string;
  readonly contextId:string;
  readonly audience:'admin'|'app';
  readonly sessionId:string|null;
  readonly epoch:number|null;
  readonly entries:readonly (WorkspaceNavigationEntryV1 & {readonly available:boolean})[];
}
/** There is no route, permission, or catalogue mutation on this port. */
export interface WorkspaceNavigationCatalogPortV1 {
  read():Promise<WorkspaceNavigationProjectionV1>;
}
