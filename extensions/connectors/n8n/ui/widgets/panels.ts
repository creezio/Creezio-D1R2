import {App,PostMessageTransport} from '@modelcontextprotocol/ext-apps';
import {n8nDirectOutput,n8nRead,n8nRender,localRunId,
  type N8nHostInput,type N8nRender,type N8nWidgetKind} from './model.ts';

const object=(value:unknown):value is Record<string,unknown>=>
  !!value&&typeof value==='object'&&!Array.isArray(value);
const text=(value:unknown)=>typeof value==='string'?value:'';
function render(kind:N8nWidgetKind,value:unknown,list:HTMLElement):string|null{
  if(!object(value))return null;
  const rows=kind==='workflows'?value.items:[value.run];
  if(!Array.isArray(rows)||rows.length>25)return null;
  let runId='';
  const items:HTMLElement[]=[];
  for(const raw of rows){
    if(!object(raw))return null;
    const item=document.createElement('li'),title=document.createElement('strong'),detail=document.createElement('small');
    if(kind==='workflows'){
      if(!localRunId(raw.id)||typeof raw.active!=='boolean')return null;
      title.textContent=text(raw.name)||raw.id;
      detail.textContent=raw.active?'Actif':'Inactif';
    }else{
      if(!localRunId(raw.id)||!['prepared','accepted'].includes(String(raw.status)))return null;
      runId=raw.id;
      title.textContent=`Intention ${runId}`;
      detail.textContent=`${text(raw.status)} · exécution ${text(raw.remoteExecutionId)||'non corrélée'} · ${text(raw.remoteStatus)||'statut non lu'}`;
    }
    item.appendChild(title);item.appendChild(detail);items.push(item);
  }
  list.replaceChildren(...items);
  return runId;
}

/** MCP Apps reads host-authorized metadata only; no webhook mutation is reachable. */
export async function startN8nWidget(){
  const root=document.querySelector<HTMLElement>('[data-n8n-widget]');
  const list=root?.querySelector<HTMLElement>('[data-items]');
  const status=root?.querySelector<HTMLElement>('[data-status]');
  const refresh=root?.querySelector<HTMLButtonElement>('[data-refresh]');
  if(!root||!list||!status||!refresh)return;
  const kind=root.dataset.n8nWidget as N8nWidgetKind;
  if(kind!=='workflows'&&kind!=='run')return;
  const app=new App({name:`Creezio n8n ${kind}`,version:'0.2.0'},{});
  let ready=false,tools=false,busy=false,serial=0,runId='',instanceId='';
  let hostInput:N8nHostInput|null=null,identity:N8nRender|null=null;
  const controls=()=>{refresh.disabled=!ready||!tools||busy||kind==='run'&&!runId;};
  app.addEventListener('toolinput',event=>{
    const input=event.arguments;
    hostInput=object(input)&&typeof input.instanceId==='string'
      &&(input.audience==='admin'||input.audience==='app')
      ?{instanceId:input.instanceId,audience:input.audience}:null;
  });
  app.addEventListener('toolresult',event=>{
    const decoded=n8nRender(kind,event.structuredContent,hostInput);
    if(!decoded){serial++;ready=false;runId='';identity=null;list.replaceChildren();controls();
      status.textContent='Résultat hors du widget ou de l’audience autorisée.';return;}
    if(instanceId&&instanceId!==decoded.instanceId){serial++;ready=false;runId='';list.replaceChildren();}
    instanceId=decoded.instanceId;
    const next=render(kind,decoded.input,list);
    ready=next!==null;runId=next??'';identity=ready?decoded:null;controls();
    status.textContent=ready?'Résultat du contexte autorisé.':'Lecture indisponible.';
  });
  refresh.addEventListener('click',async()=>{
    if(!ready||!tools||busy||!identity||kind==='run'&&!runId)return;
    const token=serial,requestedId=runId,expected=identity;
    const call=n8nRead(kind,requestedId);
    if(!call)return;
    busy=true;controls();status.textContent='Lecture en cours…';
    try{
      const response=await app.callServerTool(call);
      if(token!==serial)return;
      const next=render(kind,n8nDirectOutput(kind,response,expected,requestedId),list);
      if(next===null||kind==='run'&&next!==requestedId){
        status.textContent='Lecture refusée ou incertaine ; aucun webhook renvoyé.';return;}
      runId=next;status.textContent='Résultat relu sans nouveau déclenchement.';
    }catch{if(token===serial)status.textContent='Lecture interrompue ; aucun webhook renvoyé.';}
    finally{busy=false;controls();}
  });
  try{await app.connect(new PostMessageTransport(window.parent,window.parent));
    tools=!!app.getHostCapabilities()?.serverTools;controls();
    if(!tools)status.textContent='Lecture seule : action directe indisponible dans cet hôte.';
  }catch{status.textContent='Pont MCP Apps indisponible.';}
}
