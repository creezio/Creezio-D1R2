'use client';

import {useEffect, useRef, useState} from 'react';
import {Bot, KeyRound, Loader2, RefreshCw, Save} from 'lucide-react';
import {Button, Card, CardContent, CardDescription, CardHeader, CardTitle} from '@creezio/sdk/ui';

export interface OpenAIConfigurationView {
  readonly providerId:'openai.responses.v1';
  readonly enabled:boolean;
  readonly modelId:string|null;
  readonly state:'ready'|'missing'|'invalid'|'unavailable'|'unverified';
  readonly revision:number;
}
export type OpenAIConfigurationAction = Readonly<{kind:'ok';config:OpenAIConfigurationView}>
  | Readonly<{kind:'rejected'|'unknown';code:string}>;

export function OpenAIConfigPanel({config,busy,error,onRefresh,onSave,onSaveKey}:{
  config:OpenAIConfigurationView|null;
  busy:boolean;
  error:string|null;
  onRefresh:()=>void;
  onSave:(input:{modelId:string;enabled:boolean;revision:number})=>Promise<OpenAIConfigurationAction>;
  onSaveKey:(input:{apiKey:string;modelId:string;enabled:boolean;revision:number})=>Promise<OpenAIConfigurationAction>;
}) {
  const [modelId,setModelId]=useState('');
  const [enabled,setEnabled]=useState(false);
  const [notice,setNotice]=useState<string|null>(null);
  const [pending,setPending]=useState(false);
  const keyInput=useRef<HTMLInputElement>(null);
  useEffect(()=>{setModelId(config?.modelId??'');setEnabled(config?.enabled??false);setNotice(null);},
    [config?.modelId,config?.enabled,config?.revision]);
  const disabled=busy||pending||!config||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(modelId);
  async function save(withKey:boolean){
    if(disabled||!config)return;
    const apiKey=keyInput.current?.value??'';
    if(withKey&&!apiKey){setNotice('Saisissez la clé API à enregistrer.');return;}
    setPending(true);setNotice(null);
    try{
      const result=withKey
        ?await onSaveKey({apiKey,modelId,enabled,revision:config.revision})
        :await onSave({modelId,enabled,revision:config.revision});
      if(keyInput.current)keyInput.current.value='';
      setNotice(result.kind==='ok'?'Configuration enregistrée.':result.kind==='unknown'
        ?'Résultat incertain. Vérifiez cette opération avant de réessayer.'
        :result.code==='conflict'?'La configuration a changé. Actualisez-la avant de réessayer.'
        :'La configuration a été refusée.');
    }finally{setPending(false);}
  }
  return <Card className="max-w-2xl" data-openai-admin="configuration">
    <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
      <div><CardTitle className="flex items-center gap-2 text-base"><Bot className="h-4 w-4 text-sky-700" />OpenAI</CardTitle>
        <CardDescription>Modèle et clé serveur pour les conversations de ce contexte.</CardDescription></div>
      <Button type="button" size="sm" variant="outline" disabled={busy||pending} onClick={onRefresh}>
        <RefreshCw className="mr-1.5 h-3.5 w-3.5" />Actualiser
      </Button>
    </CardHeader>
    <CardContent className="space-y-4 text-sm">
      <p role="status" className="text-xs text-slate-600">{!config?'Chargement de la configuration…':
        config.state==='ready'?'Configuration active':config.state==='missing'?'Clé ou modèle manquant':
          config.state==='invalid'?'Configuration invalide':config.state==='unverified'
            ?'Configuration enregistrée ; modèle non vérifié':'Configuration indisponible'}</p>
      {error&&<p role="alert" className="text-xs text-red-700">{error}</p>}
      {notice&&<p role={notice.includes('incertain')||notice.includes('refusée')?'alert':'status'}
        className="text-xs text-slate-700">{notice}</p>}
      <label className="block space-y-1 text-xs font-medium text-slate-700">
        <span>Identifiant du modèle</span>
        <input value={modelId} disabled={busy||pending} onChange={event=>setModelId(event.target.value)}
          placeholder="Identifiant exact du modèle" autoComplete="off" maxLength={128}
          className="block w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
      </label>
      <label className="flex items-center gap-2 text-xs font-medium text-slate-700">
        <input type="checkbox" checked={enabled} disabled={busy||pending}
          onChange={event=>setEnabled(event.target.checked)} />Activer OpenAI pour ce contexte
      </label>
      <div className="flex flex-wrap gap-2"><Button type="button" size="sm" disabled={disabled}
        onClick={()=>void save(false)}>{pending?<Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />:
          <Save className="mr-1.5 h-3.5 w-3.5" />}Enregistrer le modèle</Button></div>
      <div className="border-t border-slate-100 pt-4">
        <label className="block space-y-1 text-xs font-medium text-slate-700"><span>Nouvelle clé API serveur</span>
          <input ref={keyInput} type="password" autoComplete="new-password" disabled={busy||pending}
            aria-label="Nouvelle clé API OpenAI" className="block w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
        </label>
        <p className="mt-1 text-xs text-slate-500">La clé enregistrée n’est jamais réaffichée.</p>
        <Button type="button" size="sm" variant="outline" className="mt-2" disabled={disabled}
          onClick={()=>void save(true)}><KeyRound className="mr-1.5 h-3.5 w-3.5" />Enregistrer la clé et le modèle</Button>
      </div>
    </CardContent>
  </Card>;
}
