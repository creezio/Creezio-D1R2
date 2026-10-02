import {App,PostMessageTransport} from '@modelcontextprotocol/ext-apps';
import {formatStripeAmount,formatStripeFrequency} from '../money.ts';

type Offer={id:string;productId:string;priceId:string;name:string;mode:'payment'|'subscription';
  enabled:boolean;unitAmountMinor:number;currency:string;interval:string|null;
  intervalCount:number|null;revision:number};
type Checkout={offerId:string;productId:string;subscriptionId:string|null;
  session:{id:string;url:string|null;mode:'payment'|'subscription';status:string;
    paymentStatus:string;livemode:false}};
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const id=(value:unknown):value is string=>typeof value==='string'&&
  /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value);
const checkoutId=(value:unknown):value is string=>typeof value==='string'&&
  /^cs_test_[A-Za-z0-9_]{1,120}$/u.test(value);
const unwrap=(value:unknown):unknown=>{
  if(!record(value))return value;
  if(value.kind==='creezio.widget.render.v1')return value.input;
  if(value.kind==='creezio.widget.action.v1'&&value.state==='succeeded')return value.output;
  return value;
};
const offer=(value:unknown):Offer|null=>{
  if(!record(value)||!id(value.id)||!id(value.productId)||!id(value.priceId)||
    typeof value.name!=='string'||!value.name||value.name.length>500||
    !['payment','subscription'].includes(String(value.mode))||value.enabled!==true||
    !Number.isSafeInteger(value.unitAmountMinor)||Number(value.unitAmountMinor)<1||
    typeof value.currency!=='string'||!/^[A-Z]{3}$/u.test(value.currency)||
    !(value.interval===null||typeof value.interval==='string')||
    !(value.intervalCount===null||Number.isSafeInteger(value.intervalCount)&&Number(value.intervalCount)>=1)||
    !Number.isSafeInteger(value.revision)||Number(value.revision)<1)return null;
  return value as Offer;
};
export const offerPage=(value:unknown):{items:Offer[];nextCursor:string|null}|null=>{
  const body=unwrap(value);
  if(!record(body)||!Array.isArray(body.items)||body.items.length>8||
    !(body.nextCursor===null||id(body.nextCursor)))return null;
  const items=body.items.map(offer);
  return items.every(Boolean)?{items:items as Offer[],nextCursor:body.nextCursor as string|null}:null;
};
export const checkoutResult=(value:unknown):Checkout|null=>{
  const body=unwrap(value);
  if(!record(body)||!id(body.offerId)||!id(body.productId)||
    !(body.subscriptionId===null||id(body.subscriptionId))||!record(body.session))return null;
  const session=body.session;
  if(!checkoutId(session.id)||!(session.url===null||typeof session.url==='string'&&
    session.url.length<=2048)||!['payment','subscription'].includes(String(session.mode))||
    typeof session.status!=='string'||typeof session.paymentStatus!=='string'||session.livemode!==false)return null;
  return body as Checkout;
};
const node=(tag:string,text?:string)=>{const result=document.createElement(tag);
  if(text!==undefined)result.textContent=text;return result;};
const element=(name:string)=>document.getElementById(name);
const button=(name:string)=>element(name) as HTMLButtonElement|null;
const say=(value:string)=>{const status=element('status');if(status)status.textContent=value;};
const result=(value:unknown):unknown=>record(value)&&value.isError===true?null:
  record(value)&&Object.hasOwn(value,'structuredContent')?value.structuredContent:value;
const link=(value:string|null):string|null=>{
  if(!value)return null;
  try{const url=new URL(value);return url.protocol==='https:'&&
    (url.hostname==='stripe.com'||url.hostname.endsWith('.stripe.com'))?url.href:null;}
  catch{return null;}
};

/** MCP Apps render results are inert; only deliberate direct actions call a tool. */
export async function mountCommerceWidget(kind:'offers'|'checkout-status'):Promise<void>{
  const root=element('stripe-commerce-widget');if(!root)return;
  const app=new App({name:`Creezio Stripe ${kind}`,version:'0.5.0'},{});
  let offers:Offer[]=[],cursor:string|null=null,checkout:Checkout|null=null,selectedOffer:Offer|null=null;
  let tools=false,openLinks=false,reading=false,commanding=false,uncertain=false,external=false,interactive=false;
  let serial=0;
  const pendingKey='creezio.stripe.widget.purchase.pending.v1';
  const pending=()=>{try{return sessionStorage.getItem(pendingKey);}catch{return 'unavailable';}};
  const writePending=(value:string)=>{try{sessionStorage.setItem(pendingKey,value);
    return sessionStorage.getItem(pendingKey)===value;}catch{return false;}};
  const clearPending=(value:string)=>{try{if(sessionStorage.getItem(pendingKey)!==value)return false;
    sessionStorage.removeItem(pendingKey);return sessionStorage.getItem(pendingKey)===null;}catch{return false;}};
  const render=()=>{
    const target=element('results');if(target){target.replaceChildren();
      if(kind==='offers'){
        for(const item of offers){const card=node('article');card.appendChild(node('strong',item.name));
          card.appendChild(node('p',`${formatStripeAmount(item.unitAmountMinor,item.currency)} · ${formatStripeFrequency(
            item.mode==='payment'?'one_time':'recurring',item.interval,item.intervalCount)}`));
          const buy=node('button','Acheter en mode test') as HTMLButtonElement;
          buy.type='button';buy.disabled=!tools||reading||commanding||uncertain;
          buy.addEventListener('click',()=>{interactive=true;selectedOffer=item;render();});
          card.appendChild(buy);target.appendChild(card);}
        if(!offers.length)target.appendChild(node('p','Aucune offre active dans ce résultat.'));
        if(selectedOffer){const confirm=node('section');confirm.className='confirmation';
          confirm.appendChild(node('strong',`Confirmer le Checkout test « ${selectedOffer.name} »`));
          confirm.appendChild(node('p',`${formatStripeAmount(selectedOffer.unitAmountMinor,
            selectedOffer.currency)} · ${formatStripeFrequency(selectedOffer.mode==='payment'?'one_time':'recurring',
            selectedOffer.interval,selectedOffer.intervalCount)}`));
          const accept=node('button','Confirmer l’achat test') as HTMLButtonElement;
          accept.type='button';accept.disabled=!tools||reading||commanding||uncertain;
          accept.addEventListener('click',()=>{interactive=true;if(selectedOffer)void create(selectedOffer);});
          const cancel=node('button','Annuler') as HTMLButtonElement;
          cancel.type='button';cancel.disabled=commanding;
          cancel.addEventListener('click',()=>{selectedOffer=null;render();});
          confirm.appendChild(accept);confirm.appendChild(cancel);target.appendChild(confirm);}
      }
      if(checkout){const card=node('article');card.appendChild(node('strong',`Session ${checkout.session.id}`));
        card.appendChild(node('p',`Statut : ${checkout.session.status} · paiement : ${checkout.session.paymentStatus}`));
        if(checkout.subscriptionId)card.appendChild(node('p',`Identifiant d’abonnement Stripe : ${checkout.subscriptionId}`));
        const href=link(checkout.session.url);
        if(href){const address=node('p',href);address.className='checkout-url';
          address.title='Adresse Checkout à copier si cet hôte ne peut pas ouvrir de lien';
          card.appendChild(address);
          if(openLinks){const open=node('button','Ouvrir Checkout Stripe') as HTMLButtonElement;
            open.type='button';open.addEventListener('click',()=>{void app.openLink({url:href}).then(response=>{
              say(response.isError?'Ouverture refusée par l’hôte ; copiez l’adresse affichée.':
                'Ouverture demandée à l’hôte.');}).catch(()=>say('Ouverture indisponible ; copiez l’adresse affichée.'));});
            card.appendChild(open);}}
        target.appendChild(card);}
      else if(kind==='checkout-status')target.appendChild(node('p','Aucune session test lue.'));
    }
    if(button('refresh'))button('refresh')!.disabled=!tools||reading||commanding;
    if(button('more'))button('more')!.disabled=!tools||reading||commanding||!cursor;
    if(button('read'))button('read')!.disabled=!tools||reading||commanding||!checkout;
  };
  const call=async(name:string,args:Record<string,unknown>)=>{
    try{return await app.callServerTool({name,arguments:args});}catch{return null;}
  };
  const readOffers=async(more=false)=>{
    if(!tools||reading||commanding||more&&!cursor)return;
    reading=true;render();const mark=++serial,previous=cursor;
    const response=await call('stripe_app_offer_list',{limit:8,...(more?{cursor:previous}:{})});
    if(mark!==serial)return;
    const page=offerPage(result(response));
    if(page&&(!more||page.nextCursor!==previous)){
      offers=more?[...offers,...page.items.filter(item=>!offers.some(old=>old.id===item.id))]:page.items;
      selectedOffer=null;
      cursor=page.nextCursor;say('Offres relues. Aucun achat déclenché.');
    }else say('Liste indisponible ou curseur inchangé.');
    reading=false;render();
  };
  const readCheckout=async()=>{
    if(!tools||reading||commanding||!checkout)return;
    reading=true;render();const id=checkout.session.id;
    const response=await call('stripe_app_checkout_read',{sessionId:id});
    const next=checkoutResult(result(response));
    if(next&&next.session.id===id){checkout=next;say('Session relue auprès du fournisseur.');}
    else say('Lecture de statut indisponible ; aucun paiement confirmé.');
    reading=false;render();
  };
  const create=async(item:Offer)=>{
    if(!tools||reading||commanding||uncertain)return;
    if(selectedOffer?.id!==item.id)return;
    selectedOffer=null;
    commanding=true;render();
    // The native Creezio host owns its durable action journal and approval. An external
    // MCP Apps host receives this pre-persisted key and must not replay an unknown result.
    const requestKey=crypto.randomUUID(),saved=JSON.stringify({requestKey,offerId:item.id});
    if(external&&(pending()||!writePending(saved))){uncertain=true;commanding=false;render();
      say('Une commande attend sa vérification ; aucun nouvel achat envoyé.');return;}
    const response=await call('stripe_app_checkout_create',{requestKey,offerId:item.id});
    const next=checkoutResult(result(response));
    const content=record(response)?response.structuredContent:null;
    if(next&&next.offerId===item.id){
      checkout=next;
      if(external&&!clearPending(saved))uncertain=true;
      say(uncertain?'Session créée, suivi incertain ; vérifiez la commande dans le chat.':
        'Session test créée. Relisez son statut après Checkout.');
    }else if(record(content)&&content.kind==='creezio.widget.action.v1'&&content.state==='rejected'){
      if(external&&!clearPending(saved))uncertain=true;
      say('Achat refusé. Relisez les offres avant un autre essai.');
    }else{uncertain=true;say('Résultat incertain. Vérifiez le statut dans le chat ; aucun nouvel achat envoyé.');}
    commanding=false;render();
  };
  app.addEventListener('toolresult',value=>{
    if(interactive)return;
    const raw=result(value),body=unwrap(raw);
    if(record(raw)&&record(raw.instance)&&raw.instance.host==='external-mcp'){
      external=true;if(pending())uncertain=true;
    }
    if(kind==='offers'){
      const page=offerPage(body);if(page){offers=page.items;cursor=page.nextCursor;selectedOffer=null;render();}
    }else{const next=checkoutResult(body);if(next){checkout=next;render();}}
  });
  render();
  try{await app.connect(new PostMessageTransport(window.parent,window.parent));}
  catch{say('Pont MCP Apps indisponible ; résultat en lecture seule.');return;}
  tools=!!app.getHostCapabilities()?.serverTools;
  openLinks=!!app.getHostCapabilities()?.openLinks;
  if(external&&pending())uncertain=true;
  render();
  say(tools?'Actions disponibles après confirmation explicite.':
    'Actions directes indisponibles dans cet hôte ; résultat en lecture seule.');
  button('refresh')?.addEventListener('click',()=>{interactive=true;void readOffers();});
  button('more')?.addEventListener('click',()=>{interactive=true;void readOffers(true);});
  button('read')?.addEventListener('click',()=>{interactive=true;void readCheckout();});
}
