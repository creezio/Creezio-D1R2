import type {WorkspaceInput,WorkspaceNavigation} from '../../sdk/workspace/types.ts';
import type {AccessSnapshot} from '../../sdk/access/types.ts';
import type {FrontProjection} from '../../sdk/front/types.ts';

export function currentProtectedSlot(state:AccessSnapshot,projection:FrontProjection|null,scope:{
  active:boolean;authorized:boolean;visible:boolean;contextId:string;compositionDigest:string;
  slotId:string;viewId:string;
}):boolean{
  return !!(scope.active&&scope.authorized&&scope.visible&&projection&&
    state.phase==='authenticated'&&!state.pending&&state.session?.audience==='app'&&
    state.session.id===projection.sessionId&&state.session.principalId===projection.principalId&&
    projection.audience==='app'&&projection.contextId===scope.contextId&&
    projection.compositionDigest===scope.compositionDigest&&
    projection.slotIds.includes(scope.slotId)&&projection.viewIds.includes(scope.viewId));
}

/** A protected slot keeps its own panel state while using the front host's route guard. */
export function protectedSlotNavigation(local:WorkspaceNavigation,host:{
  isCurrent:()=>boolean;
  open:(viewId:string,input?:WorkspaceInput,options?:{newTab?:boolean;replace?:boolean})=>boolean;
  visit:(url:string,options?:{newTab?:boolean;replace?:boolean})=>boolean;
}):WorkspaceNavigation{
  return {
    open:(viewId,input,options)=>host.isCurrent()&&host.open(viewId,input,options),
    visit:(url,options)=>host.isCurrent()&&host.visit(url,options),
    back:()=>local.back(),forward:()=>local.forward(),
    readPanelState:()=>local.readPanelState(),
    savePanelState:state=>local.savePanelState(state),
  };
}
