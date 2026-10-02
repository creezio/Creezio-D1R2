'use client';

import {useEffect,useRef,useState,useSyncExternalStore} from 'react';
import type {WorkspaceViewProps} from '@creezio/sdk/workspace/types';
import {useWorkspaceActivity} from '@creezio/sdk/workspace/components';
import {createCommandJournal,readPendingCommand,type PendingCommand} from '@creezio/sdk/operations/command-journal';
import {appPanelData,readAppPanel,retainedSessionId,sessionVerified,type StripeScope} from './panel-state.ts';
import {formatStripeAmount,formatStripeFrequency} from './money.ts';

type Offer={id:string;productId:string;priceId:string;name:string;mode:'payment'|'subscription';
  enabled:boolean;unitAmountMinor:number;currency:string;interval:string|null;
  intervalCount:number|null;revision:number};
type Checkout={offerId:string;productId:string;subscriptionId:string|null;
  session:{id:string;url:string|null;mode:'payment'|'subscription';status:string;
    paymentStatus:string;livemode:false}};
const binding=(operation:string)=>`creezio.stripe:${operation}`;
const resultOutput=(result:Awaited<ReturnType<WorkspaceViewProps['client']['invoke']>>):Record<string,unknown>|null=>
  result.kind==='execution'&&result.execution.state==='succeeded'&&result.execution.output&&
  typeof result.execution.output==='object'&&!Array.isArray(result.execution.output)
    ?result.execution.output as Record<string,unknown>:null;
const checkoutLink=(value:string|null):string|null=>{
  if(!value)return null;
  try{const url=new URL(value);return url.protocol==='https:'&&
    (url.hostname==='stripe.com'||url.hostname.endsWith('.stripe.com'))?url.href:null;}
  catch{return null;}
};

/** Authenticated offer projection in the host's selected front theme. */
export function StripeOffersView(props:WorkspaceViewProps){
  const activity=useWorkspaceActivity();
  const access=useSyncExternalStore(props.access.subscribe,props.access.getSnapshot,props.access.getSnapshot);
  const retained=useRef('');
  const sessionId=retained.current=retainedSessionId(retained.current,access);
  const verified=sessionVerified(access,sessionId);
  const active=activity&&props.active&&props.authorized&&verified&&props.audience==='app';
  const scope:StripeScope={sessionId,audience:props.audience,contextId:props.contextId,panelId:props.panelId};
  const restored=verified?readAppPanel(props.navigation.readPanelState()?.data,scope):null;
  const [offers,setOffers]=useState<Offer[]>([]),[cursor,setCursor]=useState<string|null>(null);
  const [checkout,setCheckout]=useState<Checkout|null>(null);
  const [checkoutSessionId,setCheckoutSessionId]=useState<string|null>(restored?.checkoutSessionId??null);
  const returnSessionId=/^cs_test_[A-Za-z0-9_]{1,120}$/u.test(props.input.session_id??'')
    ?props.input.session_id:null;
  const [loading,setLoading]=useState(false),[busy,setBusy]=useState(false),[checking,setChecking]=useState(false);
  const [notice,setNotice]=useState('');
  const journal=useRef<ReturnType<typeof createCommandJournal>|null>(verified?createCommandJournal(
    {sessionId,audience:'app',contextId:props.contextId},readPendingCommand(restored?.pending,
      {sessionId,audience:'app',contextId:props.contextId})):null);
  const [pending,setPending]=useState<PendingCommand|null>(journal.current?.pending??null);
  const journalKey=useRef(verified?`${sessionId}:${props.contextId}`:'');
  const checkoutIdRef=useRef(checkoutSessionId);checkoutIdRef.current=checkoutSessionId;
  const generation=useRef(0),inFlight=useRef(false),listSerial=useRef(0);
  const last=useRef({active,sessionId,client:props.client,access:props.access,
    contextId:props.contextId,panelId:props.panelId});
  if(last.current.active!==active||last.current.sessionId!==sessionId||last.current.client!==props.client||
    last.current.access!==props.access||last.current.contextId!==props.contextId||
    last.current.panelId!==props.panelId){generation.current++;last.current={active,sessionId,client:props.client,
      access:props.access,contextId:props.contextId,panelId:props.panelId};}
  const current=(token:number)=>active&&generation.current===token&&
    props.access.getSnapshot().phase==='authenticated'&&!props.access.getSnapshot().pending&&
    props.access.getSnapshot().session?.id===sessionId;
  const persist=(next:PendingCommand|null,token:number,checkoutId=checkoutIdRef.current)=>{
    if(!current(token))return false;
    const saved=props.navigation.savePanelState({data:appPanelData(scope,next,checkoutId)});
    if(saved)setPending(next);
    return saved;
  };
  const read=async(operation:'app.offer.list'|'app.checkout.read',input:Record<string,unknown>,token:number)=>{
    try{const result=await props.client.invoke({bindingId:binding(operation),contextId:props.contextId,input,
      isCurrent:()=>current(token)});
      return current(token)?resultOutput(result):null;}
    catch{return null;}
  };
  const load=async(token:number,nextCursor:string|null=null,append=false)=>{
    const serial=++listSerial.current;setLoading(true);
    const value=await read('app.offer.list',{limit:8,...(nextCursor?{cursor:nextCursor}:{})},token);
    if(!current(token)||serial!==listSerial.current)return;
    if(value&&Array.isArray(value.items)){
      const rows=(value.items as Offer[]).filter(item=>item.enabled===true);
      setOffers(previous=>append?[...previous,...rows.filter(row=>!previous.some(old=>old.id===row.id))]:rows);
      setCursor(typeof value.nextCursor==='string'?value.nextCursor:null);
      setNotice('');
    }else setNotice('Offres indisponibles ; relisez-les explicitement.');
    setLoading(false);
  };
  const readCheckout=async(id:string,token:number)=>{
    const value=await read('app.checkout.read',{sessionId:id},token);
    if(!current(token))return;
    if(value?.session&&typeof value.session==='object'&&
      (value.session as Checkout['session']).id===id&&value.offerId){
      setCheckout(value as Checkout);setCheckoutSessionId(id);checkoutIdRef.current=id;
      persist(journal.current?.pending??null,token,id);
      setNotice('État relu auprès du fournisseur.');
    }else setNotice('État de Checkout indisponible ; aucun paiement n’est confirmé.');
  };
  useEffect(()=>{
    if(!active){setOffers([]);setCursor(null);setCheckout(null);setPending(null);
      setCheckoutSessionId(null);checkoutIdRef.current=null;setBusy(false);setChecking(false);
      setLoading(false);inFlight.current=false;journal.current=null;journalKey.current='';return;}
    const key=`${sessionId}:${props.contextId}`;
    if(!journal.current||journalKey.current!==key){
      const saved=readAppPanel(props.navigation.readPanelState()?.data,scope);
      journal.current=createCommandJournal({sessionId,audience:'app',contextId:props.contextId},
        readPendingCommand(saved?.pending,{sessionId,audience:'app',contextId:props.contextId}));
      journalKey.current=key;setPending(journal.current.pending);
      const id=saved?.checkoutSessionId??null;setCheckoutSessionId(id);checkoutIdRef.current=id;
    }
    const token=generation.current;
    void load(token);
    if(returnSessionId)void readCheckout(returnSessionId,token);
    else if(checkoutIdRef.current)void readCheckout(checkoutIdRef.current,token);
  },[active,sessionId,props.client,props.access,props.contextId,props.panelId,returnSessionId]);
  const create=async(offer:Offer)=>{
    const controller=journal.current,token=generation.current;
    if(!controller||!current(token)||busy||pending||inFlight.current)return;
    if(!window.confirm(`Créer un Checkout test pour « ${offer.name} » à ${formatStripeAmount(
      offer.unitAmountMinor,offer.currency)} ?`))return;
    inFlight.current=true;setBusy(true);setNotice('');
    const outcome=await controller.execute(props.client,{sessionId,audience:'app',contextId:props.contextId,
      bindingId:binding('app.checkout.create'),requestKey:crypto.randomUUID(),intent:'app.checkout.create'},
      {offerId:offer.id},()=>current(token),value=>persist(value,token));
    if(!current(token))return;
    inFlight.current=false;setBusy(false);setPending(outcome.pending);
    const value=resultOutput(outcome.result);
    if(value?.session&&value.offerId===offer.id){
      const created=value as Checkout;
      setCheckout(created);setCheckoutSessionId(created.session.id);checkoutIdRef.current=created.session.id;
      persist(outcome.pending,token,created.session.id);
      void load(token);
      setNotice('Session test créée. Le paiement reste à vérifier après le retour de Stripe.');
    }else setNotice(outcome.pending?'Résultat incertain. Vérifiez la commande ; aucun nouvel achat ne sera envoyé.':
      outcome.result.kind==='rejected'&&outcome.result.code==='client_state_unavailable'
        ?'Suivi local indisponible ; aucun achat envoyé.':'Création refusée ou indisponible.');
  };
  const inspect=async()=>{
    const controller=journal.current,token=generation.current;
    if(!controller||!pending||checking||inFlight.current||!current(token))return;
    setChecking(true);
    const result=await controller.inspect(props.client,()=>current(token),value=>persist(value,token));
    if(!current(token))return;
    setChecking(false);setPending(result?.pending??null);
    const value=result?resultOutput(result.result):null;
    if(value?.session){const created=value as Checkout;
      setCheckout(created);setCheckoutSessionId(created.session.id);checkoutIdRef.current=created.session.id;
      persist(result?.pending??null,token,created.session.id);
      void readCheckout(created.session.id,token);
      setNotice('Commande retrouvée ; relisez l’état du Checkout.');}
    else setNotice(result?.pending?'Résultat encore incertain ; aucun nouvel envoi.':
      'Commande terminée sans session exploitable. Relisez les offres avant un autre essai.');
  };
  if(!active)return <p className="p-6 text-sm">Offres disponibles après connexion autorisée.</p>;
  const link=checkoutLink(checkout?.session.url??null);
  return <main className="mx-auto max-w-5xl space-y-5 p-6 text-slate-900">
    <header><h1 className="text-2xl font-semibold">Offres</h1>
      <p className="text-sm text-slate-600">Achats Stripe en mode test.</p></header>
    {notice?<p role="status" className="rounded-md border p-3 text-sm">{notice}</p>:null}
    {pending?<button className="rounded-md border px-3 py-2 text-sm" type="button"
      disabled={checking||busy} onClick={()=>void inspect()}>
      {checking?'Vérification…':'Vérifier la commande en attente'}</button>:null}
    <div className="flex gap-2"><button className="rounded-md border px-3 py-2 text-sm" type="button"
      disabled={loading} onClick={()=>void load(generation.current)}>Actualiser les offres</button></div>
    <section className="grid gap-4 sm:grid-cols-2" aria-label="Offres disponibles">
      {offers.map(offer=><article key={`${offer.id}:${offer.revision}`}
        className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold">{offer.name}</h2>
        <p className="mt-2 text-xl">{formatStripeAmount(offer.unitAmountMinor,offer.currency)}</p>
        <p className="text-sm text-slate-600">{formatStripeFrequency(
          offer.mode==='payment'?'one_time':'recurring',offer.interval,offer.intervalCount)}</p>
        <button className="mt-4 rounded-md border border-slate-300 px-3 py-2 text-sm disabled:opacity-50"
          type="button" disabled={busy||!!pending||loading} onClick={()=>void create(offer)}>
          {busy?'Création…':'Acheter en mode test'}</button></article>)}</section>
    {!loading&&offers.length===0?<p className="text-sm text-slate-600">Aucune offre active disponible.</p>:null}
    {cursor?<button className="rounded-md border px-3 py-2 text-sm" type="button" disabled={loading}
      onClick={()=>void load(generation.current,cursor,true)}>Afficher plus d’offres</button>:null}
    {checkout?<section className="rounded-xl border border-slate-200 bg-white p-5" aria-label="État du Checkout">
      <h2 className="font-semibold">Checkout test</h2>
      <p className="text-sm">Session {checkout.session.id} · {checkout.session.status} · {checkout.session.paymentStatus}</p>
      {checkout.subscriptionId?<p className="text-sm">Identifiant d’abonnement Stripe : {checkout.subscriptionId}</p>:null}
      {link?<a className="mt-2 inline-block text-sm underline" href={link} target="_blank"
        rel="noopener noreferrer">Ouvrir Checkout Stripe</a>:null}
      <button className="ml-3 rounded-md border px-3 py-2 text-sm" type="button"
        onClick={()=>void readCheckout(checkout.session.id,generation.current)}>Relire le statut</button>
      <p className="mt-2 text-xs text-slate-600">Le retour du navigateur ne prouve pas le paiement ; seul l’état relu fait foi.</p>
    </section>:checkoutSessionId?<button className="rounded-md border px-3 py-2 text-sm" type="button"
      onClick={()=>void readCheckout(checkoutSessionId,generation.current)}>Relire ma session test</button>:null}
  </main>;
}
