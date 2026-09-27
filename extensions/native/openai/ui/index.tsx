'use client';

import {useCallback, useEffect, useRef, useState, useSyncExternalStore} from 'react';
import type {WorkspaceViewProps} from '../../../../sdk/workspace/types.ts';
import type {OperationClientResult} from '../../../../sdk/operations/client.ts';
import {Button} from '@creezio/sdk/ui';
import {OpenAIConfigPanel, type OpenAIConfigurationAction,
  type OpenAIConfigurationView} from './config-panel.tsx';

type Pending = {bindingId:string;requestKey:string};
const operation=(audience:'admin'|'app',name:string)=>`creezio.openai:${audience}.${name}`;
const record=(value:unknown):Record<string,unknown>|null=>value&&typeof value==='object'&&!Array.isArray(value)
  ?value as Record<string,unknown>:null;
const code=(value:unknown):value is string=>typeof value==='string'&&/^[a-z][a-z0-9_]{0,63}$/.test(value);
function configuration(value:unknown):OpenAIConfigurationView|null {
  const row=record(value);
  return row?.providerId==='openai.responses.v1'&&typeof row.enabled==='boolean'
    &&(row.modelId===null||typeof row.modelId==='string'&&row.modelId.length<=128&&row.modelId.isWellFormed())
    &&['ready','missing','invalid','unavailable','unverified'].includes(String(row.state))
    &&Number.isSafeInteger(row.revision)&&Number(row.revision)>=0?row as unknown as OpenAIConfigurationView:null;
}

/** Native admin screen. Only the explicit key command ever receives plaintext key bytes. */
export function OpenAIAdminView(props:WorkspaceViewProps) {
  const access=useSyncExternalStore(props.access.subscribe,props.access.getSnapshot,props.access.getSnapshot);
  const sessionId=access.phase==='authenticated'&&!access.pending?access.session?.id??'':'';
  const live=props.active&&props.authorized&&props.audience==='admin'&&props.client.audience==='admin'&&!!sessionId;
  const [config,setConfig]=useState<OpenAIConfigurationView|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const [pending,setPending]=useState<Pending|null>(null);
  const pendingRef=useRef<Pending|null>(null);
  const previousScope=useRef('');
  const scopeKey=sessionId&&props.audience==='admin'
    ?`creezio.openai.pending:${sessionId}:${props.contextId}`
    :access.phase==='anonymous'?'':previousScope.current;
  const valid=useCallback(()=>live&&props.access.getSnapshot().session?.id===sessionId,
    [live,props.access,sessionId]);
  useEffect(()=>{
    if(previousScope.current&&previousScope.current!==scopeKey)
      try{sessionStorage.removeItem(previousScope.current);}catch{}
    previousScope.current=scopeKey;
    pendingRef.current=null;setPending(null);setConfig(null);setError(null);
    if(!scopeKey){try{for(let index=sessionStorage.length-1;index>=0;index--){
      const key=sessionStorage.key(index);if(key?.startsWith('creezio.openai.pending:'))sessionStorage.removeItem(key);
    }}catch{}return;}
    try{const stored=record(JSON.parse(sessionStorage.getItem(scopeKey)??'null'));
      if(typeof stored?.bindingId==='string'&&typeof stored.requestKey==='string'){
        const value={bindingId:stored.bindingId,requestKey:stored.requestKey};
        pendingRef.current=value;setPending(value);
      }}catch{}
  },[scopeKey]);
  const refresh=useCallback(async()=>{
    if(!valid())return;
    setBusy(true);setError(null);
    try{
      const read=await props.client.invoke({bindingId:operation('admin','config.read'),contextId:props.contextId,
        input:{},isCurrent:valid});
      if(!valid())return;
      const value=read.kind==='execution'&&read.execution.state==='succeeded'
        ?configuration(record(read.execution.output)?.config):null;
      if(!value){setConfig(null);setError(read.kind==='rejected'&&['forbidden','unauthorized'].includes(read.code)
        ?'Accès à la configuration refusé.':'Configuration indisponible.');return;}
      setConfig(value);
    }catch{if(valid())setError('Configuration indisponible.');}
    finally{if(valid())setBusy(false);}
  },[props.client,props.contextId,valid]);
  useEffect(()=>{if(live)void refresh();},[live,refresh]);
  const storePending=(value:Pending|null)=>{
    pendingRef.current=value;setPending(value);
    if(!scopeKey)return;
    try{if(value)sessionStorage.setItem(scopeKey,JSON.stringify(value));
      else sessionStorage.removeItem(scopeKey);}catch{}
  };
  async function command(name:'config.set'|'config.key.set',input:Record<string,unknown>):Promise<OpenAIConfigurationAction>{
    if(!valid()||pendingRef.current||!config)return {kind:'rejected',code:'pending_resolution'};
    const requestKey=crypto.randomUUID(),bindingId=operation('admin',name);
    const intent={bindingId,requestKey};storePending(intent);
    let result:OperationClientResult;
    try{result=await props.client.invoke({bindingId,contextId:props.contextId,
      input:{...input,requestKey},isCurrent:valid});}
    catch{return {kind:'unknown',code:'outcome_unknown'};}
    if(!valid())return {kind:'unknown',code:'stale'};
    if(result.kind==='execution'&&result.execution.state==='succeeded'){
      const next=configuration(record(result.execution.output)?.config);
      if(!next)return {kind:'unknown',code:'invalid_output'};
      storePending(null);setConfig(next);
      return {kind:'ok',config:next};
    }
    if(result.kind==='rejected'||result.kind==='execution'&&result.execution.state==='failed'){
      storePending(null);
      return {kind:'rejected',code:result.kind==='rejected'?result.code:result.execution.errorCode??'failed'};
    }
    return {kind:'unknown',code:result.kind==='unknown'&&code(result.code)?result.code:'outcome_unknown'};
  }
  async function reconcile(){
    const intent=pendingRef.current;if(!intent||!valid())return;
    setBusy(true);
    try{
      const result=await props.client.status({...intent,contextId:props.contextId,isCurrent:valid});
      if(!valid())return;
      if(result.kind==='execution'&&result.execution.state==='succeeded'){
        const next=configuration(record(result.execution.output)?.config);
        if(next){storePending(null);setConfig(next);setError(null);void refresh();}
        else setError('Réponse enregistrée invalide ; l’état reste incertain.');
      }else if(result.kind==='execution'&&result.execution.state==='failed'){
        storePending(null);setError('L’opération a échoué. Actualisez la configuration.');
      }else setError('Résultat toujours incertain ; aucune commande n’a été rejouée.');
    }catch{if(valid())setError('Résultat toujours incertain ; aucune commande n’a été rejouée.');}
    finally{if(valid())setBusy(false);}
  }
  if(props.audience!=='admin'||props.client.audience!=='admin')
    return <p role="alert">Configuration OpenAI réservée à l’administration.</p>;
  return <section className="h-full overflow-y-auto p-3" data-openai-admin-view>
    {pending&&<div role="alert" className="mb-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
      Le résultat de la dernière configuration est incertain. Vérifiez-le avant une nouvelle commande.
      <Button type="button" size="sm" variant="outline" className="ml-2" disabled={busy}
        onClick={()=>void reconcile()}>Vérifier l’opération</Button>
    </div>}
    <OpenAIConfigPanel config={config} busy={!live||busy||!!pending}
      error={error} onRefresh={()=>void refresh()}
      onSave={input=>command('config.set',input)}
      onSaveKey={input=>command('config.key.set',input)} />
  </section>;
}
