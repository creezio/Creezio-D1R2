import {App,PostMessageTransport} from '@modelcontextprotocol/ext-apps';

type State={collection:'customers'|'subscriptions'|'invoices'|'products'|'prices_active'|'prices_inactive';
  status:'partial'|'pages_exhausted';
  runId:string|null;cursor:string|null;revision:number;updatedAt:string|null};
const label:Record<State['collection'],string>={customers:'Clients',subscriptions:'Abonnements',
  invoices:'Factures',products:'Produits',prices_active:'Prix actifs',prices_inactive:'Prix inactifs'};
const unwrap=(value:unknown):unknown=>{
  if(!value||typeof value!=='object'||Array.isArray(value))return value;
  const envelope=value as Record<string,unknown>;
  if(envelope.kind==='creezio.widget.render.v1')return envelope.input;
  if(envelope.kind==='creezio.widget.action.v1'&&envelope.state==='succeeded')return envelope.output;
  return value;
};
const parse=(value:unknown):State[]|null=>{
  const body=unwrap(value);
  if(!body||typeof body!=='object'||Array.isArray(body))return null;
  const states=(body as Record<string,unknown>).states;
  // Historical 0.1.0 results contain only the original three collections.
  if(!Array.isArray(states)||![3,6].includes(states.length))return null;
  const seen=new Set<string>();
  for(const state of states){
    if(!state||typeof state!=='object'||Array.isArray(state))return null;
    const row=state as Record<string,unknown>;
    if(!['customers','subscriptions','invoices','products','prices_active','prices_inactive'].includes(String(row.collection))
      ||!['partial','pages_exhausted'].includes(String(row.status))
      ||!Number.isSafeInteger(row.revision)||seen.has(String(row.collection)))return null;
    seen.add(String(row.collection));
  }
  return states as State[];
};
const element=(id:string)=>document.getElementById(id);
/** MCP Apps status projection; its only direct action is a read of the same operation. */
export async function startSyncStatus():Promise<void>{
  const root=element('stripe-widget'),button=element('refresh') as HTMLButtonElement|null,
    output=element('status'),list=element('states');
  if(!root||!button||!output||!list)return;
  const app=new App({name:'Creezio Stripe status',version:'0.2.0'},{});
  let states:State[]|null=null,interactive=false,busy=false;
  const render=()=>{
    list.replaceChildren();
    for(const state of states??[]){
      const item=document.createElement('li'),title=document.createElement('strong'),detail=document.createElement('small');
      title.textContent=label[state.collection];
      detail.textContent=state.runId===null?'Aucun parcours lancé':state.status==='partial'
        ?'Lecture partielle — reprise nécessaire':'Dernière page atteinte — nouveaux objets possibles depuis';
      item.appendChild(title);item.appendChild(detail);list.appendChild(item);
    }
  };
  app.addEventListener('toolresult',result=>{
    if(interactive)return;
    const next=parse(result.structuredContent);
    if(next){states=next;render();}
  });
  render();
  try{await app.connect(new PostMessageTransport(window.parent,window.parent));}
  catch{output.textContent='Pont MCP Apps indisponible ; résultat en lecture seule.';return;}
  const direct=!!app.getHostCapabilities()?.serverTools;
  button.disabled=!direct;
  output.textContent=direct?'État local projeté ; aucune écriture Stripe déclenchée.':
    'Lecture directe indisponible dans cet hôte.';
  button.addEventListener('click',async()=>{
    if(!direct||busy)return;
    interactive=true;busy=true;button.disabled=true;
    try{
      const result=await app.callServerTool({name:'stripe_sync_state',arguments:{}});
      const next=result.isError?null:parse(result.structuredContent);
      if(!next){output.textContent='État indisponible ou lecture refusée.';return;}
      states=next;render();output.textContent='État relu ; aucune synchronisation déclenchée.';
    }catch{output.textContent='Lecture indisponible ; réessayez explicitement.';}
    finally{busy=false;button.disabled=!direct;}
  });
}
