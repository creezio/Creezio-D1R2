'use client';

import {useEffect,useRef,useState,useSyncExternalStore} from 'react';
import type {WorkspaceViewProps} from '@creezio/sdk/workspace/types';
import {useWorkspaceActivity} from '@creezio/sdk/workspace/components';
import {createCommandJournal,readPendingCommand,type PendingCommand} from '@creezio/sdk/operations/command-journal';
import {panelData,readPanel,retainedSessionId,scopeChange,sessionVerified,
  type StripeScope,type StripeTab} from './panel-state.ts';
import {externalConfigurationChanged,latestConfig,mergeRuns,reconcileRuns,sameConfiguration,
  type Collection,type Config,type Run} from './state.ts';
import {formatStripeAmount} from './money.ts';
import {Badge,Button,Card} from '@creezio/sdk/ui';

type Customer={id:string;name:string|null;livemode:boolean};
type Subscription={id:string;customer_id:string;status:string;currency:string|null;price_id:string|null;
  unit_amount_minor:number|null;interval:string|null;interval_count:number|null;quantity:number|null;
  period_end_at:string|null;livemode:boolean};
type Invoice={id:string;customer_id:string|null;status:string|null;currency:string;
  amount_due_minor:number;period_start_at:string|null;period_end_at:string|null;livemode:boolean};
type Page={items:(Customer|Subscription|Invoice)[];nextCursor:string|null};
const collections:Collection[]=['customers','subscriptions','invoices'];
const titles:Record<Collection,string>={customers:'Clients',subscriptions:'Abonnements',invoices:'Factures'};
const SUB_STATUT_LABEL:Record<string,string>={active:'Actif',trialing:'Essai',past_due:'Impayé',
  canceled:'Résilié',unpaid:'Impayé',incomplete:'Incomplet'};
const INVOICE_STATUT_LABEL:Record<string,string>={paid:'Payée',open:'En attente',payment_failed:'Échouée',
  uncollectible:'Irrécouvrable',void:'Annulée',draft:'Brouillon'};
const subVariant=(value:string|null):'default'|'secondary'|'danger'|'outline'=>
  value==='active'||value==='trialing'?'default':value==='canceled'?'secondary':!value?'outline':'danger';
const invoiceVariant=(value:string|null):'default'|'secondary'|'danger'=>
  value==='paid'?'default':value==='void'||value==='draft'?'secondary':'danger';
const binding=(operation:string)=>`creezio.stripe:admin.${operation}`;
const output=(result:Awaited<ReturnType<WorkspaceViewProps['client']['invoke']>>):Record<string,unknown>|null=>
  result.kind==='execution'&&result.execution.state==='succeeded'&&result.execution.output&&
  typeof result.execution.output==='object'&&!Array.isArray(result.execution.output)
    ?result.execution.output as Record<string,unknown>:null;
const date=(value:string|null|undefined)=>value?new Date(value).toLocaleDateString('fr-FR'):'—';
const status=(value:string|null|undefined)=>value??'—';

/** Original billing cards and tables, fed only by bounded local Stripe projections. */
export function StripeAdminView(props:WorkspaceViewProps){
  const activity=useWorkspaceActivity();
  const access=useSyncExternalStore(props.access.subscribe,props.access.getSnapshot,props.access.getSnapshot);
  const retained=useRef('');
  const sessionId=retained.current=retainedSessionId(retained.current,access);
  const verified=sessionVerified(access,sessionId);
  const active=activity&&props.active&&props.authorized&&verified&&props.audience==='admin';
  const scope:StripeScope={sessionId,audience:props.audience,contextId:props.contextId,panelId:props.panelId};
  const restored=verified?readPanel(props.navigation.readPanelState()?.data,scope):null;
  const [tab,setTab]=useState<StripeTab>(restored?.tab??'overview');
  const [config,setConfig]=useState<Config|null>(null),[apiKey,setApiKey]=useState('');
  const [enabled,setEnabled]=useState(false),[enableRevision,setEnableRevision]=useState<number|null>(null);
  const [runs,setRuns]=useState<Run[]>([]),[pages,setPages]=useState<Partial<Record<Collection,Page>>>({});
  const [busy,setBusy]=useState(false),[checking,setChecking]=useState(false);
  const [loading,setLoading]=useState<Record<Collection,boolean>>({customers:false,subscriptions:false,invoices:false});
  const [showSync,setShowSync]=useState(false);
  const [notice,setNotice]=useState('');
  const journal=useRef<ReturnType<typeof createCommandJournal>|null>(verified?createCommandJournal(
    {sessionId,audience:props.audience,contextId:props.contextId},
    readPendingCommand(restored?.pending,{sessionId,audience:props.audience,contextId:props.contextId})):null);
  const journalScope=useRef({sessionId:verified?sessionId:'',audience:props.audience,contextId:props.contextId});
  const [pending,setPending]=useState<PendingCommand|null>(journal.current?.pending??null);
  const prior=useRef(scope),generation=useRef(0),
    listSerial=useRef<Record<Collection,number>>({customers:0,subscriptions:0,invoices:0}),overviewSerial=useRef(0),
    inFlight=useRef(false),configVersion=useRef(0);
  const tabRef=useRef(tab);tabRef.current=tab;
  const last=useRef({active,sessionId,client:props.client,access:props.access,audience:props.audience,
    contextId:props.contextId,panelId:props.panelId});
  const changed=last.current.active!==active||last.current.sessionId!==sessionId||last.current.client!==props.client||
    last.current.access!==props.access||last.current.audience!==props.audience||
    last.current.contextId!==props.contextId||last.current.panelId!==props.panelId;
  if(changed){generation.current++;last.current={active,sessionId,client:props.client,access:props.access,
    audience:props.audience,contextId:props.contextId,panelId:props.panelId};}
  const current=(token:number)=>active&&generation.current===token&&
    props.access.getSnapshot().phase==='authenticated'&&!props.access.getSnapshot().pending&&
    props.access.getSnapshot().session?.id===sessionId;
  const invalidateLists=()=>{for(const id of collections)listSerial.current[id]++;};
  const persist=(value:PendingCommand|null,token:number)=>{
    if(!current(token))return false;
    const saved=props.navigation.savePanelState({activeSubview:tabRef.current,
      data:panelData(scope,tabRef.current,value)});
    if(saved)setPending(value);
    return saved;
  };
  const read=async(operation:string,input:Record<string,unknown>,token:number)=>{
    try{
      const result=await props.client.invoke({bindingId:binding(operation),contextId:props.contextId,input,
        isCurrent:()=>current(token)});
      if(!current(token))return null;
      const value=output(result);
      if(!value)setNotice(result.kind==='unknown'?'Lecture incertaine ; relisez explicitement.':
        'Lecture Stripe indisponible ou refusée.');
      return value;
    }catch{if(current(token))setNotice('Lecture interrompue.');return null;}
  };
  const loadOverview=async(token:number)=>{
    const serial=++overviewSerial.current;
    const configuration=await read('config.read',{},token);
    if(!current(token)||serial!==overviewSerial.current)return;
    const states=configuration?.config?await read('sync.state',{},token):null;
    if(!current(token)||serial!==overviewSerial.current)return;
    const verification=states?await read('config.read',{},token):null;
    if(!current(token)||serial!==overviewSerial.current)return;
    const first=configuration?.config as Config|undefined;
    const next=verification?.config as Config|undefined;
    if(!next){invalidateLists();setPages({});setRuns([]);return;}
    if(!first||!sameConfiguration(first,next)){
      invalidateLists();setPages({});setRuns([]);setConfig(next);configVersion.current=next.revision;
      setNotice('La connexion a changé pendant la lecture. Actualisez les parcours.');return;
    }
    const rotated=!!next&&externalConfigurationChanged(configVersion.current,next);
    if(next&&next.revision>=configVersion.current){
      if(rotated){invalidateLists();setPages({});
        if(tabRef.current==='overview')for(const id of collections)void loadPage(id,token);
        else if(collections.includes(tabRef.current as Collection))void loadPage(tabRef.current as Collection,token);}
      configVersion.current=next.revision;
      setConfig(old=>latestConfig(old,next));if(enableRevision===null)setEnabled(next.enabled);}
    setRuns(old=>reconcileRuns(old,Array.isArray(states?.states)?states.states as Run[]:[],rotated));
  };
  const loadPage=async(collection:Collection,token:number,cursor:string|null=null,append=false)=>{
    const serial=++listSerial.current[collection];
    setLoading(old=>({...old,[collection]:true}));
    const value=await read(`${collection.slice(0,-1)}.list`,{limit:25,...(cursor?{cursor}:{})},token);
    if(!current(token)||serial!==listSerial.current[collection])return;
    if(value&&Array.isArray(value.items)){
      const rows=value.items as Page['items'];
      setPages(previous=>({
      ...previous,[collection]:{items:append?[...(previous[collection]?.items??[]),
        ...rows.filter(row=>!(previous[collection]?.items??[]).some(old=>old.id===row.id))]:rows,
        nextCursor:value.nextCursor as string|null}}));
    }
    setLoading(old=>({...old,[collection]:false}));
  };
  useEffect(()=>{
    const phase=access.pending?'loading':access.phase;
    const transition=scopeChange(prior.current,scope,phase);
    if(transition.purge){overviewSerial.current++;configVersion.current=0;
      setTab('overview');tabRef.current='overview';setConfig(null);setApiKey('');
      setEnabled(false);setEnableRevision(null);setRuns([]);setPages({});setPending(null);setNotice('');
      setShowSync(false);invalidateLists();
      journal.current=null;journalScope.current={sessionId:'',audience:props.audience,contextId:props.contextId};}
    if(!transition.transient)prior.current=scope;
    if(!active){setLoading({customers:false,subscriptions:false,invoices:false});
      setBusy(false);setChecking(false);inFlight.current=false;return;}
    if(!journal.current||journalScope.current.sessionId!==sessionId||
      journalScope.current.audience!==props.audience||journalScope.current.contextId!==props.contextId){
      const saved=transition.purge?null:readPanel(props.navigation.readPanelState()?.data,scope);
      journal.current=createCommandJournal({sessionId,audience:props.audience,contextId:props.contextId},
        readPendingCommand(saved?.pending,{sessionId,audience:props.audience,contextId:props.contextId}));
      journalScope.current={sessionId,audience:props.audience,contextId:props.contextId};
      setPending(journal.current.pending);setBusy(false);inFlight.current=false;
      if(saved){setTab(saved.tab);tabRef.current=saved.tab;}
    }
    setPending(journal.current.pending);
    const token=generation.current;
    void loadOverview(token);
    if(tabRef.current==='overview')for(const id of collections)void loadPage(id,token);
    else if(collections.includes(tabRef.current as Collection))void loadPage(tabRef.current as Collection,token);
  },[active,sessionId,access.phase,access.pending,props.client,props.access,props.audience,props.contextId,props.panelId]);
  const changeTab=(next:StripeTab)=>{
    setTab(next);tabRef.current=next;
    if(journal.current)persist(journal.current.pending,generation.current);
    if(next==='overview')for(const id of collections)void loadPage(id,generation.current);
    else if(collections.includes(next as Collection))void loadPage(next as Collection,generation.current);
  };
  const mutate=async(operation:string,input:Record<string,unknown>)=>{
    const controller=journal.current,token=generation.current;
    if(!controller||!current(token)||busy||pending||inFlight.current)return;
    inFlight.current=true;setBusy(true);setNotice('');
    const outcome=await controller.execute(props.client,{sessionId,audience:'admin',contextId:props.contextId,
      bindingId:binding(operation),requestKey:crypto.randomUUID(),intent:operation},input,
      ()=>current(token),value=>persist(value,token));
    if(!current(token))return;
    inFlight.current=false;setPending(outcome.pending);setBusy(false);
    const value=output(outcome.result);
    if(value){
      overviewSerial.current++;
      if(value.config){const next=value.config as Config;configVersion.current=next.revision;
        setConfig(old=>latestConfig(old,next));setEnabled(next.enabled);
        setEnableRevision(null);if(operation.startsWith('config.key.'))setApiKey('');}
      if(operation.startsWith('config.key.')){invalidateLists();setRuns([]);setPages({});}
      if(value.state){const next=value.state as Run;setRuns(old=>mergeRuns(old,[next]));}
      if(operation==='sync.page'&&value.state)void loadPage((value.state as Run).collection,token);
      if(operation.startsWith('sync.')||operation.startsWith('config.key.'))void loadOverview(token);
      setNotice(operation==='sync.page'?`Page enregistrée (${value.processed??0} objet(s)).`:'Modification confirmée.');
    }else setNotice(outcome.pending?'Résultat incertain. Vérifiez son statut avant toute nouvelle commande.':
      outcome.result.kind==='rejected'&&outcome.result.code==='client_state_unavailable'
        ?'Suivi local indisponible ; aucune commande envoyée.':'Modification refusée.');
  };
  const inspect=async()=>{
    const controller=journal.current,token=generation.current;
    if(!controller||!pending||checking||inFlight.current||busy||!current(token))return;
    setChecking(true);
    const result=await controller.inspect(props.client,()=>current(token),value=>persist(value,token));
    if(!current(token))return;
    setChecking(false);setPending(result?.pending??null);
    const value=result?output(result.result):null;
    if(value){overviewSerial.current++;}
    if(value?.config){const next=value.config as Config;configVersion.current=next.revision;
      setConfig(old=>latestConfig(old,next));setEnabled(next.enabled);
      setEnableRevision(null);setApiKey('');}
    if(pending.intent?.startsWith('config.key.')&&value){invalidateLists();setRuns([]);setPages({});}
    if(value?.state){const next=value.state as Run;setRuns(old=>mergeRuns(old,[next]));}
    if(pending.intent==='sync.page'&&value?.state)void loadPage((value.state as Run).collection,token);
    if((pending.intent?.startsWith('sync.')||pending.intent?.startsWith('config.key.'))&&value)
      void loadOverview(token);
    setNotice(value?'Modification confirmée.':result?.pending?'Résultat toujours incertain ; aucun nouvel envoi.':
      'Modification refusée.');
  };
  const ownScope=prior.current.sessionId===sessionId&&prior.current.audience===props.audience&&
    prior.current.contextId===props.contextId&&prior.current.panelId===props.panelId;
  if(!active||!ownScope)return <div className="p-6 text-sm">Facturation indisponible pour cette session.</div>;
  const customers=(pages.customers?.items??[]) as Customer[];
  const subscriptions=(pages.subscriptions?.items??[]) as Subscription[];
  const invoices=(pages.invoices?.items??[]) as Invoice[];
  const rows=[...customers.flatMap<{customer:Customer|null;subscription:Subscription|null}>(customer=>{
    const linked=subscriptions.filter(subscription=>subscription.customer_id===customer.id);
    return linked.length?linked.map(subscription=>({customer,subscription})):[{customer,subscription:null}];
  }),...subscriptions.filter(subscription=>!customers.some(customer=>customer.id===subscription.customer_id))
    .map(subscription=>({customer:null,subscription}))];
  const showCustomers=tab==='overview'||tab==='customers'||tab==='subscriptions';
  const showInvoices=tab==='overview'||tab==='invoices';
  return <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-6">
    <div className="flex items-center justify-between gap-2"><div><h1 className="text-2xl font-semibold">Facturation</h1>
      <p className="text-sm text-muted-foreground">Abonnements et factures Stripe.</p></div>
      <div className="flex items-center gap-2"><Button size="sm" onClick={()=>setShowSync(value=>!value)}>
        Resynchroniser Stripe</Button></div></div>
    <nav className="flex flex-wrap gap-2" aria-label="Sections facturation">{(['overview',...collections,'settings'] as StripeTab[]).map(value=>
      <Button key={value} type="button" size="sm" variant={tab===value?'default':'outline'}
        aria-current={tab===value?'page':undefined} onClick={()=>changeTab(value)}>
        {value==='overview'?'Vue générale':value==='settings'?'Connexion':titles[value]}</Button>)}</nav>
    {notice?<Card role="status" className="border-destructive p-3 text-sm text-destructive">{notice}</Card>:null}
    {pending?<Button type="button" size="sm" variant="outline" disabled={checking||inFlight.current}
      onClick={()=>void inspect()}>Vérifier la dernière commande</Button>:null}
    {showSync?<Card className="p-4"><h2 className="mb-3 text-base font-semibold">Lecture Stripe par pages</h2>
      <p className="mb-3 text-sm text-muted-foreground">Chaque action lit au plus huit objets. La dernière page ne garantit pas une vue à jour en continu.</p>
      <div className="grid gap-3 sm:grid-cols-3">{collections.map(id=>{
        const run=runs.find(row=>row.collection===id),ready=!!config?.enabled&&config.hasKey;
        return <div key={id} className="rounded-md border p-3 text-sm"><h3 className="font-medium">{titles[id]}</h3>
          <p>{!run?.runId?'Aucun parcours':run.status==='partial'?'Parcours partiel':'Dernière page atteinte'}</p>
          <p className="text-xs text-muted-foreground">Mis à jour : {date(run?.updatedAt)}</p>
          <div className="mt-2 flex flex-wrap gap-2"><Button size="sm" variant="outline" type="button"
            disabled={!ready||busy||!!pending} onClick={()=>void mutate('sync.start',
              {collection:id,runId:crypto.randomUUID(),revision:run?.revision??0})}>Nouveau parcours</Button>
            <Button size="sm" variant="outline" type="button"
              disabled={!ready||busy||!!pending||!run?.runId||run.status!=='partial'}
              onClick={()=>void mutate('sync.page',{collection:id,runId:run!.runId,cursor:run!.cursor,
                expectedRevision:run!.revision,limit:8})}>Lire une page</Button></div></div>;})}</div></Card>:null}
    {tab==='overview'?<div className="grid gap-3 sm:grid-cols-3">
      {['Revenu mensuel (MRR)','Abonnements actifs','Factures impayées'].map(label=><Card key={label} className="p-4">
        <div className="text-xs uppercase text-muted-foreground">{label}</div>
        <div className="mt-1 text-2xl font-semibold">—</div>
        <div className="text-xs text-muted-foreground">Calcul non disponible sur ce parcours partiel</div></Card>)}</div>:null}
    {showCustomers?<Card className="p-4"><div className="mb-3 flex items-center justify-between gap-2">
      <h2 className="text-base font-semibold">Clients &amp; abonnements</h2>
      <Button size="sm" variant="outline" type="button" onClick={()=>{
        void loadPage('customers',generation.current);void loadPage('subscriptions',generation.current);}}>Actualiser</Button></div>
      {loading.customers||loading.subscriptions?<div className="text-sm text-muted-foreground">Chargement…</div>:null}
      {rows.length===0?<div className="text-sm text-muted-foreground">Aucun client facturé projeté.</div>:
        <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left text-xs uppercase text-muted-foreground">
          <th className="py-2 pr-3">Client</th><th className="py-2 pr-3">Plan</th>
          <th className="py-2 pr-3">Montant</th><th className="py-2 pr-3">Statut</th>
          <th className="py-2">Prochaine échéance</th></tr></thead><tbody>
          {rows.map(({customer,subscription},index)=><tr key={`${customer?.id??subscription?.customer_id}-${subscription?.id??index}`}
            className="border-b last:border-0"><td className="py-2 pr-3"><div className="font-medium">{customer?.name||customer?.id||subscription?.customer_id}</div>
              <div className="text-xs text-muted-foreground">{customer?.id??'—'}</div></td>
            <td className="py-2 pr-3">{subscription?.price_id??'—'}</td>
            <td className="py-2 pr-3">{subscription?formatStripeAmount(subscription.unit_amount_minor,subscription.currency):'—'}</td>
            <td className="py-2 pr-3"><Badge variant={subVariant(subscription?.status??null)}>
              {subscription?.status?SUB_STATUT_LABEL[subscription.status]||subscription.status:'Sans abonnement'}</Badge></td>
            <td className="py-2">{date(subscription?.period_end_at)}</td></tr>)}</tbody></table></div>}
      <div className="mt-3 flex gap-2">{(['customers','subscriptions'] as const).map(id=>pages[id]?.nextCursor?
        <Button key={id} size="sm" variant="outline" type="button" disabled={loading[id]}
          onClick={()=>void loadPage(id,generation.current,pages[id]!.nextCursor,true)}>Suite {titles[id].toLowerCase()}</Button>:null)}</div>
      <p className="mt-2 text-xs text-muted-foreground">Les listes restent partielles tant que les parcours Stripe ne sont pas terminés.</p>
    </Card>:null}
    {showInvoices?<Card className="p-4"><div className="mb-3 flex items-center justify-between gap-2">
      <h2 className="text-base font-semibold">Factures</h2>
      <Button size="sm" variant="outline" type="button" onClick={()=>void loadPage('invoices',generation.current)}>Actualiser</Button></div>
      {loading.invoices?<div className="text-sm text-muted-foreground">Chargement…</div>:null}
      {invoices.length===0?<div className="text-sm text-muted-foreground">Aucune facture projetée.</div>:
        <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left text-xs uppercase text-muted-foreground">
          <th className="py-2 pr-3">Client</th><th className="py-2 pr-3">Période</th><th className="py-2 pr-3">Montant</th>
          <th className="py-2 pr-3">Statut</th><th className="py-2">Facture Stripe</th></tr></thead><tbody>
          {invoices.map(invoice=><tr key={invoice.id} className="border-b last:border-0">
            <td className="py-2 pr-3 font-medium">{customers.find(customer=>customer.id===invoice.customer_id)?.name||invoice.customer_id||'—'}</td>
            <td className="py-2 pr-3">{date(invoice.period_start_at)} – {date(invoice.period_end_at)}</td>
            <td className="py-2 pr-3">{formatStripeAmount(invoice.amount_due_minor,invoice.currency)}</td>
            <td className="py-2 pr-3"><Badge variant={invoiceVariant(invoice.status)}>
              {invoice.status?INVOICE_STATUT_LABEL[invoice.status]||invoice.status:'—'}</Badge></td>
            <td className="py-2 text-xs text-muted-foreground">{invoice.id}</td></tr>)}</tbody></table></div>}
      {pages.invoices?.nextCursor?<Button className="mt-3" size="sm" variant="outline" type="button"
        disabled={loading.invoices} onClick={()=>void loadPage('invoices',generation.current,pages.invoices!.nextCursor,true)}>
        Suite factures</Button>:null}</Card>:null}
    {tab==='overview'?<Card className="p-4"><h2 className="mb-3 text-base font-semibold">Événements Stripe reçus</h2>
      <div className="text-sm text-muted-foreground">Aucun webhook n’est raccordé dans ce module.</div></Card>:null}
    {tab==='settings'?<Card className="p-4"><h2 className="mb-3 text-base font-semibold">Connexion Stripe</h2>
      <p className="mb-3 text-sm text-muted-foreground">La clé est conservée dans le coffre serveur.</p>
      <p className="mb-3 text-sm">État : {config?.hasKey?'Clé enregistrée':'Clé absente'} · {config?.enabled?'active':'suspendue'}</p>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={enabled}
        disabled={busy||!!pending||!config?.hasKey} onChange={event=>{if(enableRevision===null)setEnableRevision(config?.revision??0);
          setEnabled(event.target.checked);}}/>Connexion active</label>
      <Button className="mt-2" size="sm" variant="outline" type="button"
        disabled={busy||!!pending||enabled&&!config?.hasKey}
        onClick={()=>void mutate('config.set',{enabled,revision:enableRevision??config?.revision??0})}>
        Enregistrer la configuration</Button>
      <div className="mt-4 flex flex-wrap items-end gap-2"><label className="grid gap-1 text-sm">Clé secrète Stripe
        <input className="rounded-md border px-3 py-2 text-sm" type="password" autoComplete="off" maxLength={4096}
          value={apiKey} disabled={busy||!!pending||!config} onChange={event=>setApiKey(event.target.value)}/></label>
        <Button size="sm" variant="outline" type="button" disabled={busy||!!pending||!config||apiKey.length<8}
          onClick={()=>void mutate('config.key.set',{apiKey,revision:config!.revision})}>Enregistrer la clé</Button>
        <Button size="sm" variant="outline" type="button" disabled={busy||!!pending||!config?.hasKey}
          onClick={()=>void mutate('config.key.revoke',{revision:config!.revision})}>Révoquer la clé</Button></div>
      <Button className="mt-3" size="sm" variant="outline" type="button" disabled={!config?.enabled||busy||!!pending}
        onClick={()=>void read('connection.check',{},generation.current).then(value=>{
          if(value?.reachable===true)setNotice('Connexion Stripe joignable.');})}>Vérifier la connexion</Button></Card>:null}
  </div>;
}
