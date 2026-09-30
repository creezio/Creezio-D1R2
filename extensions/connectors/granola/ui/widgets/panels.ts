import {App,PostMessageTransport} from '@modelcontextprotocol/ext-apps';

type Kind='notes'|'summary'|'transcript'|'sync';
const body=(value:unknown):Record<string,unknown>|null=>{
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const record=value as Record<string,unknown>;
  if(record.kind==='creezio.widget.render.v1')return body(record.input);
  if(record.kind==='creezio.widget.action.v1'&&record.state==='succeeded')return body(record.output);
  return record;
};
const object=(value:unknown):Record<string,unknown>|null=>value&&typeof value==='object'&&!Array.isArray(value)
  ?value as Record<string,unknown>:null;
const safe=(value:unknown)=>typeof value==='string'?value:'';
function render(kind:Kind,value:Record<string,unknown>,list:HTMLElement){
  list.replaceChildren();
  const rows=kind==='notes'?value.items:kind==='transcript'?value.segments:
    kind==='sync'?value.states:[value.note];
  if(!Array.isArray(rows))return false;
  for(const raw of rows.slice(0,25)){
    const row=object(raw);if(!row)return false;
    const item=document.createElement('li'),title=document.createElement('strong'),detail=document.createElement('small');
    if(kind==='notes'){
      title.textContent=safe(row.title)||'Sans titre';
      detail.textContent=safe(row.owner)||safe(row.note_created_at);
      item.dataset.search=safe(row.title).toLocaleLowerCase();
    }else if(kind==='summary'){
      title.textContent=safe(row.title)||'Sans titre';detail.textContent=safe(row.summary_text)||'Résumé non synchronisé.';
    }else if(kind==='transcript'){
      title.textContent=safe(row.speaker_name)||'Intervenant';detail.textContent=safe(row.text);
    }else{
      title.textContent=row.collection==='folders'?'Dossiers':'Notes';
      detail.textContent=row.status==='pages_exhausted'?'Dernière page lue':'Lecture partielle';
    }
    item.appendChild(title);item.appendChild(detail);list.appendChild(item);
  }
  return true;
}
/** MCP Apps renders authenticated host results only; no supplier fetch or mutation is reachable. */
export async function startGranolaWidget(){
  const root=document.querySelector<HTMLElement>('[data-granola-widget]');
  const list=root?.querySelector<HTMLElement>('[data-items]');
  const status=root?.querySelector<HTMLElement>('[data-status]');
  if(!root||!list||!status)return;
  const kind=root.dataset.granolaWidget as Kind;
  if(!['notes','summary','transcript','sync'].includes(kind))return;
  const app=new App({name:`Creezio Granola ${kind}`,version:'0.1.0'},{});
  let last:Record<string,unknown>|null=null,busy=false;
  app.addEventListener('toolresult',result=>{
    const value=body(result.structuredContent);
    if(value&&render(kind,value,list)){last=value;status.textContent='Données du contexte autorisé.';}
    else status.textContent='Lecture indisponible ou refusée.';
  });
  const search=root.querySelector<HTMLInputElement>('[data-search]');
  search?.addEventListener('input',()=>{
    const query=search.value.toLocaleLowerCase();
    for(const item of list.querySelectorAll<HTMLElement>('li'))
      item.hidden=!!query&&!String(item.dataset.search??'').includes(query);
  });
  try{await app.connect(new PostMessageTransport(window.parent,window.parent));}
  catch{status.textContent='Pont MCP Apps indisponible.';}
  const refresh=root.querySelector<HTMLButtonElement>('[data-refresh]');
  if(!refresh)return;
  const direct=!!app.getHostCapabilities()?.serverTools;
  refresh.disabled=!direct;
  refresh.addEventListener('click',async()=>{
    if(!direct||busy)return;
    const note=object(last?.note),segments=Array.isArray(last?.segments)?last.segments:[];
    const firstSegment=segments.length?object(segments[0]):null;
    const id=kind==='summary'?safe(note?.id):safe(last?.note_id)||safe(firstSegment?.note_id);
    if((kind==='summary'||kind==='transcript')&&!/^not_[A-Za-z0-9]{1,60}$/.test(id)){
      status.textContent='Identifiant de note absent ; ouvrez la fiche depuis un résultat autorisé.';return;
    }
    const input=kind==='notes'?{limit:25}:kind==='summary'?{id}:
      kind==='transcript'?{id,cursor:null,limit:25}:{};
    const name=kind==='notes'?'granola_note_list':kind==='summary'?'granola_note_detail':
      kind==='transcript'?'granola_transcript_page':'granola_sync_state';
    busy=true;refresh.disabled=true;
    try{
      const result=await app.callServerTool({name,arguments:input});
      const next=result.isError?null:body(result.structuredContent);
      if(!next||!render(kind,next,list)){status.textContent='Lecture indisponible ou refusée.';return;}
      last=next;status.textContent='Résultat relu sans synchronisation.';
    }catch{status.textContent='Lecture indisponible.';}
    finally{busy=false;refresh.disabled=!direct;}
  });
}
