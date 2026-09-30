import {App,PostMessageTransport} from '@modelcontextprotocol/ext-apps';

type Entity='company'|'contact'|'prospect';
type Mode='initial'|'list'|'search';
type Item={id:string;name:string;city:string|null;notes:string|null;createdAt:string;updatedAt:string;
  archivedAt:string|null;revision:number;website?:string|null;email?:string|null;phone?:string|null;
  companyId?:string|null;contactName?:string|null;contactId?:string|null;stage?:string;position?:number};
const names:Record<Entity,string>={company:'Entreprises',contact:'Contacts',prospect:'Prospection'};
const stages=[{id:'a_contacter',label:'À contacter'},{id:'contacte',label:'Contacté'},
  {id:'rdv',label:'RDV / démo'},{id:'client',label:'Client 🎉'},{id:'perdu',label:'Perdu'}] as const;
const id=(value:unknown):value is string=>typeof value==='string'&&
  /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value);
const optional=(value:unknown,max:number):value is string|null=>value===null||
  typeof value==='string'&&value.length<=max;
const date=(value:unknown):value is string=>typeof value==='string'&&value.length<=35;
const element=(name:string)=>document.getElementById(name);
const tell=(value:string)=>{const target=element('status');if(target)target.textContent=value;};
const unwrap=(value:unknown):unknown=>{
  if(!value||typeof value!=='object'||Array.isArray(value))return value;
  const result=value as Record<string,unknown>;
  if(result.kind==='creezio.widget.render.v1')return result.input;
  if(result.kind==='creezio.widget.action.v1'&&result.state==='succeeded')return result.output;
  return value;
};
function parseItem(value:unknown,entity:Entity):Item|null{
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const item=value as Record<string,unknown>;
  if(!id(item.id)||typeof item.name!=='string'||!item.name||item.name.length>240||
    !optional(item.city,240)||!optional(item.notes,4000)||
    !date(item.createdAt)||!date(item.updatedAt)||
    !(item.archivedAt===null||date(item.archivedAt))||
    !Number.isSafeInteger(item.revision)||Number(item.revision)<1)return null;
  if(entity==='company'&&!optional(item.website,512))return null;
  if(entity==='contact'&&(!optional(item.email,320)||!optional(item.phone,240)||
    !(item.companyId===null||id(item.companyId))))return null;
  if(entity==='prospect'&&(!optional(item.contactName,240)||!optional(item.email,320)||
    !optional(item.phone,240)||!optional(item.website,512)||
    !(item.companyId===null||id(item.companyId))||!(item.contactId===null||id(item.contactId))||
    !stages.some(stage=>stage.id===item.stage)||!Number.isSafeInteger(item.position)||
    Number(item.position)<0))return null;
  return item as Item;
}
function parsePage(value:unknown,entity:Entity):{items:Item[];nextCursor:string|null}|null{
  const data=unwrap(value);
  if(!data||typeof data!=='object'||Array.isArray(data))return null;
  const body=data as Record<string,unknown>;
  if(!Array.isArray(body.items)||body.items.length>25||
    !(body.nextCursor===null||typeof body.nextCursor==='string'&&body.nextCursor.length<=2048))return null;
  const items=body.items.map(item=>parseItem(item,entity));
  return items.every(Boolean)?{items:items as Item[],nextCursor:body.nextCursor as string|null}:null;
}
function parseDetail(value:unknown,entity:Entity):Item|null{
  const data=unwrap(value);
  if(!data||typeof data!=='object'||Array.isArray(data))return null;
  return parseItem((data as Record<string,unknown>).item,entity);
}
function node(tag:string,className?:string,text?:string):HTMLElement{
  const made=document.createElement(tag);if(className)made.className=className;
  if(text!==undefined)made.textContent=text;return made;
}
function card(item:Item,entity:Entity):HTMLElement{
  const result=node('article','crm-card');
  result.appendChild(node('strong','crm-card-title',item.name));
  const secondary=entity==='company'?[item.city,item.website]:entity==='contact'
    ?[item.city,item.email,item.phone]:[item.city,item.contactName,item.phone];
  result.appendChild(node('span','crm-card-meta',secondary.filter(Boolean).join(' · ')||'—'));
  if(item.notes)result.appendChild(node('span','crm-card-notes',
    item.notes.length>160?`${item.notes.slice(0,160)}…`:item.notes));
  if(item.archivedAt)result.appendChild(node('small','crm-card-archived','Archivé'));
  return result;
}
function renderList(entity:Entity,items:readonly Item[]):void{
  const target=element('results');if(!target)return;
  target.replaceChildren();
  if(entity==='prospect'){
    for(const stage of stages){
      const section=node('section','crm-stage');
      const group=items.filter(item=>item.stage===stage.id).sort((a,b)=>
        (a.position??0)-(b.position??0)||a.name.localeCompare(b.name));
      section.appendChild(node('h2','crm-stage-title',`${stage.label} · ${group.length}`));
      for(const item of group)section.appendChild(card(item,entity));
      if(!group.length)section.appendChild(node('p','crm-empty-stage','Aucune fiche sur cette page'));
      target.appendChild(section);
    }
  }else{
    for(const item of items)target.appendChild(card(item,entity));
  }
  if(!items.length)target.appendChild(node('p','crm-empty','Aucune fiche dans ce résultat.'));
}
function line(label:string,value:unknown):HTMLElement|null{
  if(typeof value!=='string'||!value)return null;
  const row=node('div','crm-field');row.appendChild(node('dt',undefined,label));
  row.appendChild(node('dd',undefined,value));return row;
}
function renderDetail(entity:Entity,item:Item|null):void{
  const name=element('name'),fields=element('fields');
  if(name)name.textContent=item?.name??'Fiche indisponible';
  if(!fields)return;fields.replaceChildren();if(!item)return;
  const values:[string,unknown][]=[['Ville',item.city]];
  if(entity==='company')values.push(['Site web',item.website]);
  if(entity==='contact')values.push(['E-mail',item.email],['Téléphone',item.phone],
    ['Référence entreprise',item.companyId]);
  if(entity==='prospect')values.push(['Étape',stages.find(stage=>stage.id===item.stage)?.label],
    ['Nom du contact',item.contactName],['E-mail',item.email],['Téléphone',item.phone],
    ['Site web',item.website],['Référence entreprise',item.companyId],['Référence contact',item.contactId]);
  values.push(['Notes',item.notes],['Dernière modification',item.updatedAt]);
  if(item.archivedAt)values.push(['Archivé le',item.archivedAt]);
  for(const [label,value] of values){const row=line(label,value);if(row)fields.appendChild(row);}
}

/** The host supplies the historical result; only a deliberate click calls a CRM query. */
export async function mountCrmWidget(entity:Entity,kind:'list'|'detail'):Promise<void>{
  const app=new App({name:`Creezio CRM ${names[entity]} ${kind}`,version:'0.1.0'},{});
  const root=element('crm-widget');if(!root)return;
  const all=element('all') as HTMLButtonElement|null;
  const search=element('search') as HTMLButtonElement|null;
  const more=element('more') as HTMLButtonElement|null;
  const refresh=element('refresh') as HTMLButtonElement|null;
  const query=element('query') as HTMLInputElement|null;
  let items:Item[]=[],detail:Item|null=null,nextCursor:string|null=null,mode:Mode='initial';
  let appliedQuery='',appliedArchived=false,pageLimit=10,interactive=false,reading=false,serial=0,tools=false;
  let initialRequest:{mode:'list'|'search';query:string;archived:boolean;limit:number}|null=null;
  const controls=()=>{
    if(all)all.disabled=!tools||reading;
    if(search)search.disabled=!tools||reading;
    if(more)more.disabled=!tools||reading||!nextCursor||mode==='initial';
    if(refresh)refresh.disabled=!tools||reading||!detail;
  };
  const render=()=>{if(kind==='list')renderList(entity,items);else renderDetail(entity,detail);controls();};
  app.addEventListener('toolinput',input=>{
    if(kind!=='list'||interactive||!input.arguments||typeof input.arguments!=='object'||
      Array.isArray(input.arguments))return;
    const args=input.arguments as Record<string,unknown>;
    if(!Object.keys(args).every(key=>['limit','query','cursor','archived'].includes(key))||
      !Number.isInteger(args.limit)||Number(args.limit)<1||Number(args.limit)>25||
      args.cursor!==undefined&&!(typeof args.cursor==='string'&&args.cursor.length<=2048)||
      args.archived!==undefined&&typeof args.archived!=='boolean')return;
    if(args.query===undefined)initialRequest={mode:'list',query:'',archived:args.archived===true,limit:Number(args.limit)};
    else if(typeof args.query==='string'&&args.query.length>=1&&args.query.length<=120)
      initialRequest={mode:'search',query:args.query,archived:args.archived===true,limit:Number(args.limit)};
  });
  app.addEventListener('toolresult',result=>{
    if(interactive||result.isError===true)return;
    if(kind==='list'){
      const page=parsePage(result.structuredContent,entity);
      if(page){items=page.items;nextCursor=page.nextCursor;
        if(initialRequest){mode=initialRequest.mode;appliedQuery=initialRequest.query;
          appliedArchived=initialRequest.archived;pageLimit=initialRequest.limit;
          if(query&&initialRequest.mode==='search')query.value=initialRequest.query;}
        render();
        if(nextCursor&&mode==='initial'&&tools)
          tell('Suite disponible : relancez la liste ou la recherche pour parcourir les pages.');}
    }else{
      const item=parseDetail(result.structuredContent,entity);
      if(item){detail=item;render();}
    }
  });
  render();
  try{await app.connect(new PostMessageTransport(window.parent,window.parent));}
  catch{tell('Pont MCP Apps indisponible ; résultat en lecture seule.');return;}
  tools=!!app.getHostCapabilities()?.serverTools;controls();
  tell(!tools?'Outils directs indisponibles dans cet hôte ; résultat en lecture seule.':
    kind==='list'&&nextCursor&&mode==='initial'
      ?'Suite disponible : relancez la liste ou la recherche pour parcourir les pages.':
      'Lecture prête ; les requêtes sont déclenchées volontairement.');
  const request=async(action:'list'|'search'|'more'|'read')=>{
    if(!tools||reading)return;
    const currentQuery=query?.value.trim()??'';
    if(action==='search'&&(!currentQuery||currentQuery.length>120)){
      tell('Saisissez une recherche de 1 à 120 caractères.');return;
    }
    if(action==='more'&&(!nextCursor||mode==='initial')){
      tell('Relancez la liste ou la recherche pour accéder à la suite.');return;
    }
    if(action==='read'&&!detail)return;
    interactive=true;reading=true;const mark=++serial;
    const sentCursor=action==='more'?nextCursor:null;
    const sentMode:Mode=action==='more'?mode:action==='search'?'search':'list';
    const sentQuery=action==='more'?appliedQuery:currentQuery;
    const sentArchived=action==='more'?appliedArchived:false;
    const sentLimit=action==='more'?pageLimit:10;
    const priorId=detail?.id,priorRevision=detail?.revision??0;
    controls();tell('Lecture en cours…');
    try{
      const operation=action==='read'?'read':sentMode;
      const argumentsValue=action==='read'?{id:priorId}:operation==='search'
        ?{limit:sentLimit,query:sentQuery,...(sentArchived?{archived:true}:{}),
          ...(sentCursor?{cursor:sentCursor}:{})}
        :{limit:sentLimit,...(sentArchived?{archived:true}:{}),...(sentCursor?{cursor:sentCursor}:{})};
      const result=await app.callServerTool({name:`crm_${entity}_${operation}`,arguments:argumentsValue});
      if(mark!==serial||!root.isConnected)return;
      if(result.isError){tell('Lecture refusée ou indisponible.');return;}
      if(action==='read'){
        const loaded=parseDetail(result.structuredContent,entity);
        if(!loaded||loaded.id!==priorId||loaded.revision<priorRevision){
          tell('Fiche obsolète ou résultat invalide.');return;}
        detail=loaded;
      }else{
        const page=parsePage(result.structuredContent,entity);
        if(!page||action==='more'&&page.nextCursor===sentCursor){
          tell('Page invalide ou curseur inchangé.');return;}
        items=page.items;
        nextCursor=page.nextCursor;mode=sentMode;appliedQuery=sentQuery;
        appliedArchived=sentArchived;pageLimit=sentLimit;
      }
      render();tell(nextCursor&&kind==='list'?'Page chargée ; la suite reste disponible.':'Lecture terminée.');
    }catch{tell('Lecture indisponible ; relancez-la si nécessaire.');}
    finally{reading=false;controls();}
  };
  all?.addEventListener('click',()=>void request('list'));
  search?.addEventListener('click',()=>void request('search'));
  more?.addEventListener('click',()=>void request('more'));
  refresh?.addEventListener('click',()=>void request('read'));
  query?.addEventListener('keydown',event=>{if(event.key==='Enter')void request('search');});
}

export const startCompanyList=()=>{void mountCrmWidget('company','list');};
export const startCompanyDetail=()=>{void mountCrmWidget('company','detail');};
export const startContactList=()=>{void mountCrmWidget('contact','list');};
export const startContactDetail=()=>{void mountCrmWidget('contact','detail');};
export const startProspectList=()=>{void mountCrmWidget('prospect','list');};
export const startProspectDetail=()=>{void mountCrmWidget('prospect','detail');};
