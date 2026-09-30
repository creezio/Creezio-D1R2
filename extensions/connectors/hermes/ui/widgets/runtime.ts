import {App,PostMessageTransport} from '@modelcontextprotocol/ext-apps';
import {hermesDirectOutput,hermesRead,hermesRender,localRunId,
  type HermesHostInput,type HermesRender,type HermesWidgetKind} from './model.ts';

type Kind=HermesWidgetKind;
const record=(value:unknown):value is Record<string,unknown>=>
  !!value&&typeof value==='object'&&!Array.isArray(value);
const text=(value:unknown,max=128)=>typeof value==='string'&&value.length<=max?value:'';
const line=(label:string,value:string)=>{
  const item=document.createElement('li'),strong=document.createElement('strong'),detail=document.createElement('span');
  strong.textContent=label;detail.textContent=value;item.appendChild(strong);item.appendChild(detail);return item;
};

function show(kind:Kind,value:unknown,list:HTMLElement,result:HTMLElement):string|null{
  if(!record(value))return null;
  const rows:HTMLElement[]=[];
  let output='';
  if(kind==='capabilities'){
    const capabilities=record(value.capabilities)?value.capabilities:null;
    const features=record(capabilities?.features)?capabilities.features:null;
    if(!capabilities||!features||!text(capabilities.model)||!text(capabilities.observedAt,64))return null;
    rows.push(line('Modèle annoncé',text(capabilities.model)),line('Lu le',text(capabilities.observedAt,64)));
    for(const name of ['run_submission','run_status','run_events_sse','run_stop']){
      if(typeof features[name]!=='boolean')return null;
      rows.push(line(name,features[name]?'disponible':'absent'));
    }
  }else if(kind==='models'){
    if(!Array.isArray(value.models)||value.models.length>100)return null;
    for(const item of value.models){
      if(!record(item)||!text(item.id))return null;
      rows.push(line('Modèle',text(item.id)));
    }
  }else{
    const run=record(value.run)?value.run:null;
    if(!run||!localRunId(run.id)||!Number.isSafeInteger(run.revision)||Number(run.revision)<1)return null;
    rows.push(line('Run local',run.id),line('Révision',String(run.revision)));
    if(run.remote===null){
      rows.push(line('État',text(run.status,32)||'Préparé'));
    }else{
      const remote=record(run.remote)?run.remote:null;
      if(!remote||!localRunId(remote.runId)||!text(remote.status,32))return null;
      rows.push(line('État Hermes',text(remote.status,32)),line('Modèle',text(remote.model)||'non annoncé'));
      output=text(remote.output,64_000);
    }
  }
  list.replaceChildren(...rows);
  result.textContent=output;
  return kind==='run'&&record(value.run)?String(value.run.id):'';
}

/** One bounded MCP Apps view for native chat and external GPT hosts; calls use their current grant. */
export async function startHermesWidget(){
  const root=document.querySelector<HTMLElement>('[data-hermes-widget]');
  const list=root?.querySelector<HTMLElement>('[data-items]');
  const result=root?.querySelector<HTMLElement>('[data-result]');
  const status=root?.querySelector<HTMLElement>('[data-status]');
  const refresh=root?.querySelector<HTMLButtonElement>('[data-read]');
  if(!root||!list||!result||!status||!refresh)return;
  const kind=root.dataset.hermesWidget as Kind;
  if(!['capabilities','models','run'].includes(kind))return;
  const app=new App({name:`Creezio Hermes ${kind}`,version:'0.1.1'},{});
  let ready=false,tools=false,busy=false,serial=0,runId='',instanceId='';
  let hostInput:HermesHostInput|null=null,renderIdentity:HermesRender|null=null;
  const controls=()=>{refresh.disabled=!ready||!tools||busy||kind==='run'&&!runId;};
  app.addEventListener('toolinput',event=>{
    const input=event.arguments;
    hostInput=record(input)&&typeof input.instanceId==='string'
      &&(input.audience==='admin'||input.audience==='app')
      ?{instanceId:input.instanceId,audience:input.audience}:null;
  });
  app.addEventListener('toolresult',event=>{
    const envelope=event.structuredContent;
    if(!record(envelope)||envelope.kind!=='creezio.widget.render.v1')return;
    const rendered=hermesRender(kind,envelope,hostInput);
    if(!rendered){
      serial++;ready=false;runId='';renderIdentity=null;list.replaceChildren();result.textContent='';controls();
      status.textContent='Résultat hors du widget ou de l’audience autorisée.';return;
    }
    // A new host instance invalidates in-flight reads from the previous session/context.
    if(instanceId&&instanceId!==rendered.instanceId){serial++;ready=false;runId='';list.replaceChildren();result.textContent='';}
    instanceId=rendered.instanceId;
    const next=show(kind,rendered.input,list,result);
    ready=next!==null;runId=next??'';renderIdentity=ready?rendered:null;controls();
    status.textContent=ready?'Résultat autorisé. Relisez pour vérifier l’état courant.':'Résultat indisponible.';
  });
  refresh.addEventListener('click',async()=>{
    if(!ready||!tools||busy||!renderIdentity||kind==='run'&&!runId)return;
    const token=serial,requestedId=runId,identity=renderIdentity;
    busy=true;controls();status.textContent='Lecture en cours…';
    const call=hermesRead(kind,requestedId);
    if(!call){busy=false;controls();return;}
    try{
      const response=await app.callServerTool(call);
      if(token!==serial)return;
      const next=show(kind,hermesDirectOutput(kind,response,identity,requestedId),list,result);
      if(next===null||kind==='run'&&next!==requestedId){
        status.textContent='Issue indéterminée ou lecture refusée. Vérifiez la commande d’origine ; aucun POST n’est renvoyé.';
        return;
      }
      runId=next;status.textContent='État relu avec les droits courants.';
    }catch{
      if(token===serial)status.textContent='Lecture interrompue. Vérifiez la commande d’origine ; aucun POST n’est renvoyé.';
    }finally{busy=false;controls();}
  });
  try{await app.connect(new PostMessageTransport(window.parent,window.parent));
    tools=!!app.getHostCapabilities()?.serverTools;controls();
    if(!tools)status.textContent='Lecture seule : actions directes indisponibles dans cet hôte.';
  }catch{status.textContent='Pont MCP Apps indisponible.';}
}
