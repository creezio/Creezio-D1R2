import type {WorkspacePanelState,WorkspaceViewProps} from '@creezio/sdk/workspace/types';
import {readPendingCommand} from '@creezio/sdk/operations/command-journal';
import type {Period,Tab} from './contracts.ts';

type AccessSnapshot=ReturnType<WorkspaceViewProps['access']['getSnapshot']>;

export type AnalyticsScope={sessionId:string;audience:'admin'|'app';contextId:string};
export type AnalyticsPanel={tab:Tab;period:Period;query:string;type:string;principalId:string};
const tabs=new Set(['overview','productivity','pages','clicks','users','logs']);
const periods=new Set(['day','week','month','year']);

export function sameAnalyticsScope(previous:AnalyticsScope,current:AnalyticsScope):boolean{
  return previous.sessionId===current.sessionId&&previous.audience===current.audience&&
    previous.contextId===current.contextId;
}

export function retainedSessionId(previous:string,access:AccessSnapshot):string{
  if(access.phase==='anonymous')return '';
  if(access.phase==='authenticated'&&!access.pending)return access.session?.id??'';
  return previous;
}
export function sessionVerified(access:AccessSnapshot,sessionId:string):boolean{
  return !!sessionId&&access.phase==='authenticated'&&!access.pending&&access.session?.id===sessionId;
}
export function readAnalyticsPanelState(value:WorkspacePanelState|null,scope:AnalyticsScope):AnalyticsPanel|null{
  const data=value?.data;
  if(!scope.sessionId||!data||data.sessionId!==scope.sessionId||data.audience!==scope.audience
    ||data.contextId!==scope.contextId||!tabs.has(String(value.activeSubview))
    ||!periods.has(String(data.period))||typeof data.query!=='string'||data.query.length>120
    ||typeof data.type!=='string'||data.type.length>16
    ||typeof data.principalId!=='string'||data.principalId.length>128)return null;
  return {tab:value.activeSubview as Tab,period:data.period as Period,query:data.query,
    type:data.type,principalId:data.principalId};
}
export function analyticsPanelState(scope:AnalyticsScope,panel:AnalyticsPanel,pending:unknown=null):WorkspacePanelState{
  const retained=readPendingCommand(pending,scope);
  return {activeSubview:panel.tab,data:{...scope,period:panel.period,query:panel.query,
    type:panel.type,principalId:panel.principalId,...(retained?{pending:retained}:{})}};
}
