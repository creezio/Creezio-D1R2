import {App,PostMessageTransport} from '@modelcontextprotocol/ext-apps';

type Hit={id:string;fields:Record<string,unknown>};
type Result={source:string;items:Hit[];pageCount:number;stale:boolean};
const record=(value:unknown):Record<string,unknown>|null=>value&&typeof value==='object'
  &&!Array.isArray(value)?value as Record<string,unknown>:null;
const unwrap=(value:unknown):unknown=>{
  const row=record(value);
  if(row?.kind==='creezio.widget.render.v1')return row.input;
  if(row?.kind==='creezio.widget.action.v1'&&row.state==='succeeded')return row.output;
  return value;
};
export const searchResultFrom=(value:unknown):Result|null=>{
  const row=record(unwrap(value));
  if(!row||typeof row.source!=='string'||row.source.length>257||!Array.isArray(row.items)
    ||row.items.length>20||!Number.isSafeInteger(row.pageCount)||row.pageCount!==row.items.length
    ||typeof row.stale!=='boolean')return null;
  const items:Hit[]=[];
  for(const raw of row.items){const hit=record(raw);
    if(!hit||typeof hit.id!=='string'||hit.id.length>128||!record(hit.fields))return null;
    items.push({id:hit.id,fields:hit.fields as Record<string,unknown>});}
  return {source:row.source,items,pageCount:row.pageCount as number,stale:row.stale};
};
/** The server has already reauthorized each hit; the widget only displays those fields. */
export async function startSearchResults():Promise<void>{
  const root=document.getElementById('meili-widget'),results=document.getElementById('results');
  const status=document.getElementById('status'),button=document.getElementById('direct') as HTMLButtonElement|null;
  const query=document.getElementById('query') as HTMLInputElement|null;
  if(!root||!results||!status||!button||!query)return;
  const app=new App({name:'Creezio Meili search',version:'0.3.0'},{});
  let current:Result|null=null,tools=false,busy=false,serial=0,interactive=false;
  const say=(message:string)=>{status.textContent=message;};
  const render=()=>{
    results.replaceChildren();
    for(const hit of current?.items??[]){
      const article=document.createElement('article'),title=document.createElement('strong');
      const name=hit.fields.name;
      title.textContent=typeof name==='string'&&name.length?name:hit.id;
      article.appendChild(title);
      for(const [field,value] of Object.entries(hit.fields)){
        if(field==='name'||field==='id'||value===null||typeof value==='object')continue;
        const detail=document.createElement('small');detail.textContent=`${field} : ${String(value)}`;
        article.appendChild(detail);
      }
      results.appendChild(article);
    }
    if(current&&!current.items.length){const empty=document.createElement('p');
      empty.textContent='Aucun résultat visible sur cette page.';results.appendChild(empty);}
    button.disabled=!tools||!current?.source||busy;
    if(current?.stale)say('Projection en cours : ces résultats peuvent être anciens.');
  };
  app.addEventListener('toolresult',event=>{
    if(interactive)return;
    const next=searchResultFrom(event.structuredContent);
    if(next){current=next;render();}
  });
  render();
  try{await app.connect(new PostMessageTransport(window.parent,window.parent));}
  catch{say('Pont MCP Apps indisponible ; affichage en lecture seule.');return;}
  tools=!!app.getHostCapabilities()?.serverTools;
  render();
  button.addEventListener('click',async()=>{
    if(!tools||busy||!current?.source)return;
    const q=query.value.trim();if(q.length>256)return;
    interactive=true;busy=true;const mark=++serial;render();
    try{const result=await app.callServerTool({name:'meili_index_search',
      arguments:{source:current.source,q,limit:20,offset:0}});
      if(mark!==serial)return;
      const next=!result.isError?searchResultFrom(result.structuredContent):null;
      if(!next||next.source!==current.source){say('Recherche refusée ou indisponible.');return;}
      current=next;render();say(next.stale?'Projection en cours : résultats potentiellement anciens.':
        `${next.pageCount} résultat(s) visibles sur cette page.`);
    }catch{say('Recherche indisponible.');}
    finally{busy=false;render();}
  });
}
