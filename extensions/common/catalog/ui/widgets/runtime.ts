import {App,PostMessageTransport} from '@modelcontextprotocol/ext-apps';
import {money} from '../money.ts';

type Summary={id:string;sku:string;name:string;categoryId:string|null;priceMinor:number;
  currency:string;status:'published';revision:number;updatedAt:string};
type Detail=Summary&{description:string;attributes:{key:string;value:string}[];createdAt:string};
const uuid=(value:unknown):value is string=>typeof value==='string'
  &&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value);
const product=(value:unknown):Summary|null=>{
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const item=value as Record<string,unknown>;
  if(!uuid(item.id)||typeof item.name!=='string'||item.name.length>160
    ||typeof item.sku!=='string'||item.sku.length>80
    ||!Number.isSafeInteger(item.priceMinor)||Number(item.priceMinor)<0
    ||typeof item.currency!=='string'||!/^[A-Z]{3}$/u.test(item.currency)
    ||item.status!=='published'||!Number.isSafeInteger(item.revision))return null;
  return item as Summary;
};
const unwrap=(value:unknown):unknown=>{
  if(!value||typeof value!=='object'||Array.isArray(value))return value;
  const envelope=value as Record<string,unknown>;
  if(envelope.kind==='creezio.widget.render.v1')return envelope.input;
  if(envelope.kind==='creezio.widget.action.v1'&&envelope.state==='succeeded')return envelope.output;
  return value;
};
function productFrom(value:unknown):Detail|null{
  const envelope=unwrap(value);
  const raw=envelope&&typeof envelope==='object'&&!Array.isArray(envelope)
    ?(envelope as Record<string,unknown>).product:null;
  const base=product(raw);
  if(!base||!raw||typeof raw!=='object'||Array.isArray(raw))return null;
  const item=raw as Record<string,unknown>;
  if(typeof item.description!=='string'||item.description.length>1200
    ||!Array.isArray(item.attributes)||item.attributes.length>12
    ||!item.attributes.every(attr=>attr&&typeof attr==='object'&&!Array.isArray(attr)
      &&typeof attr.key==='string'&&typeof attr.value==='string'))return null;
  return raw as Detail;
}
function productsFrom(value:unknown):Summary[]|null{
  const envelope=unwrap(value);
  const raw=envelope&&typeof envelope==='object'&&!Array.isArray(envelope)
    ?(envelope as Record<string,unknown>).items:null;
  if(!Array.isArray(raw)||raw.length>25)return null;
  const parsed=raw.map(product);
  return parsed.every(Boolean)?parsed as Summary[]:null;
}
const el=(id:string)=>document.getElementById(id);
const say=(message:string)=>{const status=el('status');if(status)status.textContent=message;};
/** MCP Apps rendering never calls the business operation until a user chooses Refresh/Search. */
export async function mountCatalogWidget(kind:'list'|'detail'):Promise<void>{
  const app=new App({name:`Creezio catalog ${kind}`,version:'0.1.0'},{});
  const root=el('catalog-widget'),direct=el('direct') as HTMLButtonElement|null;
  if(!root||!direct)return;
  let list:Summary[]=[],detail:Detail|null=null,interactive=false,reading=false,serial=0;
  const render=()=>{
    if(kind==='detail'){
      const name=el('name'),sku=el('sku'),price=el('price'),description=el('description'),attrs=el('attributes');
      if(name)name.textContent=detail?.name??'Produit indisponible';
      if(sku)sku.textContent=detail?.sku??'—';
      if(price)price.textContent=detail?money(detail.priceMinor,detail.currency):'—';
      if(description)description.textContent=detail?.description??'';
      if(attrs){attrs.replaceChildren();for(const attr of detail?.attributes??[]){
        const row=document.createElement('li');row.textContent=`${attr.key} : ${attr.value}`;attrs.appendChild(row);}}
    }else{
      const results=el('results');if(!results)return;results.replaceChildren();
      if(!list.length){const empty=document.createElement('p');empty.textContent='Aucun produit publié dans ce résultat.';
        results.appendChild(empty);}
      for(const item of list){const card=document.createElement('article'),title=document.createElement('strong'),
        detail=document.createElement('span');
        title.textContent=item.name;detail.textContent=`${item.sku} · ${money(item.priceMinor,item.currency)}`;
        card.appendChild(title);card.appendChild(detail);results.appendChild(card);}
    }
    direct.disabled=reading||kind==='detail'&&!detail;
  };
  app.addEventListener('toolresult',result=>{
    if(interactive)return;
    if(kind==='list'){const next=productsFrom(result.structuredContent);if(next){list=next;render();}}
    else{const next=productFrom(result.structuredContent);if(next){detail=next;render();}}
  });
  render();
  try{await app.connect(new PostMessageTransport(window.parent,window.parent));}
  catch{say('Pont MCP Apps indisponible ; affichage en lecture seule.');return;}
  const tools=!!app.getHostCapabilities()?.serverTools;
  direct.disabled=!tools||kind==='detail'&&!detail;
  say(tools?'Données du catalogue chargé ; la recherche est déclenchée volontairement.':
    'Outils directs indisponibles dans cet hôte ; résultat en lecture seule.');
  direct.addEventListener('click',async()=>{
    if(!tools||reading||kind==='detail'&&!detail)return;
    interactive=true;reading=true;serial++;const mark=serial;
    const id=detail?.id,revision=detail?.revision??0;
    direct.disabled=true;
    try{
      const query=kind==='list'?(el('query') as HTMLInputElement|null)?.value.trim()??'':'';
      if(query.length>120){say('Recherche trop longue.');return;}
      const result=await app.callServerTool({name:kind==='list'?'catalog_product_search':'catalog_product_get',
        arguments:kind==='list'?{limit:25,...(query?{query}:{})}:{id}});
      if(mark!==serial)return;
      if(result.isError){say('Lecture refusée ou indisponible.');return;}
      if(kind==='list'){
        const next=productsFrom(result.structuredContent);
        if(!next){say('Résultat invalide.');return;}
        list=next;
      }else{
        const next=productFrom(result.structuredContent);
        if(!next||next.id!==id||next.revision<revision){say('Fiche obsolète ou invalide.');return;}
        detail=next;
      }
      render();say('Lecture directe terminée ; aucun panier ni paiement déclenché.');
    }catch{say('Lecture incertaine ; relisez le catalogue avant de poursuivre.');}
    finally{reading=false;direct.disabled=!tools||kind==='detail'&&!detail;}
  });
}
