import {App,PostMessageTransport} from '@modelcontextprotocol/ext-apps';

type Kind='boxes'|'messages'|'drafts';
type Row=Record<string,unknown>;
const elem=(id:string)=>document.getElementById(id);
const record=(v:unknown):v is Row=>!!v&&typeof v==='object'&&!Array.isArray(v);
const validId=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&v.length<=128;
const text=(v:unknown,max:number)=>typeof v==='string'&&v.length<=max;
const previewText=(v:unknown)=>typeof v==='string'&&Array.from(v).length<=48;
const node=(tag:string,className:string,value:string)=>{const e=document.createElement(tag);
  e.className=className;e.textContent=value;return e;};
const unwrap=(v:unknown):unknown=>record(v)&&v.kind==='creezio.widget.render.v1'?v.input:
  record(v)&&v.kind==='creezio.widget.action.v1'&&v.state==='succeeded'?v.output:v;
const output=(v:unknown):unknown=>record(v)&&v.isError===true?null:
  record(v)&&Object.hasOwn(v,'structuredContent')?unwrap(v.structuredContent):unwrap(v);
const preview=(row:Row,key:'peer'|'subject'|'body')=>{
  const value=row[`${key}Excerpt`],more=row[`${key}HasMore`];
  return typeof value==='string'?value+(more===true?'…':''):'';};
function page(v:unknown,kind:Kind):{items:Row[];nextCursor:string|null}|null{
  const value=output(v);if(!record(value)||!Array.isArray(value.items)||value.items.length>5||
    !(value.nextCursor===null||text(value.nextCursor,2048)))return null;
  const items=value.items.filter(record);
  if(items.length!==value.items.length||items.some(item=>!validId(item.id)||
    kind!=='boxes'&&!validId(item.boxId)||!Number.isSafeInteger(item.revision)||Number(item.revision)<1||
    kind==='boxes'&&(!previewText(item.nameExcerpt)||!previewText(item.addressExcerpt))||
    kind!=='boxes'&&(!previewText(item.peerExcerpt)||!previewText(item.subjectExcerpt)||!previewText(item.bodyExcerpt))))return null;
  return {items,nextCursor:value.nextCursor as string|null};
}
function detail(v:unknown,kind:Kind,id:string):Row|null{
  const value=output(v),item=record(value)?value[kind==='messages'?'message':'draft']:null;
  if(!record(item)||item.id!==id||!validId(item.boxId)||!text(item.subject,240)||
    !text(item.text,16000)||!text(item.html,32000)||!Number.isSafeInteger(item.revision))return null;
  return item;
}
const title={boxes:'Boîtes',messages:'Messages',drafts:'Brouillons'};
const listName={boxes:'box_preview_list',messages:'message_preview_list',drafts:'draft_preview_list'};
const readName={messages:'message_read',drafts:'draft_read'};

/** Rendering is read-only; no operation is dispatched at mount or on a result event. */
export async function mountMessagingWidget(kind:Kind):Promise<void>{
  const root=elem('messaging-widget');if(!root)return;
  const app=new App({name:`Creezio ${title[kind]}`,version:'0.1.0'},{});
  let tools=false,busy=false,serial=0,interactive=false,items:Row[]=[],nextCursor:string|null=null;
  let openButtons:HTMLButtonElement[]=[];
  let origin:Record<string,unknown>|null=kind==='boxes'?{limit:5}:null,selected:Row|null=null;
  const status=(value:string)=>{const e=elem('status');if(e)e.textContent=value;};
  const controls=()=>{
    const refresh=elem('refresh') as HTMLButtonElement|null,more=elem('more') as HTMLButtonElement|null;
    const search=elem('search') as HTMLButtonElement|null;
    if(refresh)refresh.disabled=!tools||busy||kind!=='boxes'&&!origin;
    if(more)more.disabled=!tools||busy||!origin||!nextCursor;
    if(search)search.disabled=!tools||busy||!origin;
    for(const button of openButtons)button.disabled=!tools||busy;
  };
  const render=()=>{
    const target=elem('list');if(target){target.replaceChildren();openButtons=[];
      for(const item of items){const card=node('article','messaging-row','');
        const subject=kind==='boxes'?String(item.nameExcerpt)+(item.nameHasMore?'…':''):
          preview(item,'subject')||'(sans objet)';
        card.appendChild(node('strong','messaging-subject',subject));
        card.appendChild(node('p','messaging-peer',kind==='boxes'
          ?String(item.addressExcerpt)+(item.addressHasMore?'…':''):
          `${preview(item,'peer')} · ${kind==='drafts'?'Brouillon':String(item.folder)}`));
        if(kind!=='boxes'&&preview(item,'body'))card.appendChild(node('p','messaging-preview',preview(item,'body')));
        if(kind!=='boxes'){
          const open=node('button','messaging-button','Lire') as HTMLButtonElement;
          open.type='button';open.disabled=!tools||busy;openButtons.push(open);
          open.addEventListener('click',()=>{interactive=true;void read(item);});card.appendChild(open);
        }
        target.appendChild(card);
      }
      if(!items.length)target.appendChild(node('p','messaging-empty','Aucun élément sur cette page.'));
    }
    const reader=elem('reader');if(reader){reader.replaceChildren();
      if(selected){reader.appendChild(node('h3','messaging-subject',String(selected.subject)||'(sans objet)'));
        reader.appendChild(node('p','messaging-peer',String(selected.to||selected.from||'')));
        reader.appendChild(node('pre','messaging-body',String(selected.text)||
          (selected.html?'Message HTML : ouvrir la messagerie pour la mise en forme.':'(message vide)')));}}
    controls();
  };
  app.addEventListener('toolinput',event=>{
    if(interactive||!record(event)||!record(event.arguments))return;
    const args=event.arguments;
    if(!Number.isInteger(args.limit)||Number(args.limit)<1||Number(args.limit)>5||
      kind!=='boxes'&&!validId(args.boxId)||
      args.cursor!==undefined&&!text(args.cursor,2048)||
      args.query!==undefined&&!text(args.query,240)||
      kind==='messages'&&args.folder!==undefined&&!['inbox','sent','outbox','archive','trash'].includes(String(args.folder)))return;
    origin={...args};
    const folder=elem('folder') as HTMLSelectElement|null;
    if(folder&&typeof args.folder==='string')folder.value=args.folder;
  });
  app.addEventListener('toolresult',event=>{
    if(interactive)return;const parsed=page(event,kind);
    if(parsed){items=parsed.items;nextCursor=parsed.nextCursor;render();
      if(tools&&nextCursor&&!origin)status('Suite disponible : relancez la liste depuis le chat.');}
    else if(kind!=='boxes'){
      const value=output(event),candidate=record(value)?value[kind==='messages'?'message':'draft']:null;
      if(record(candidate)&&validId(candidate.id)){
        const loaded=detail(event,kind,candidate.id);
        if(loaded){selected=loaded;items=[];nextCursor=null;render();}
      }
    }
  });
  render();
  try{await app.connect(new PostMessageTransport(window.parent,window.parent));}
  catch{status('Pont MCP indisponible ; résultat en lecture seule.');return;}
  tools=!!app.getHostCapabilities()?.serverTools;controls();
  status(!tools?'Outils directs indisponibles ; résultat en lecture seule.':
    nextCursor&&!origin?'Suite disponible : relancez la liste depuis le chat.':
    'Lectures disponibles sur demande.');
  async function list(more:boolean){
    if(!tools||busy||!origin||more&&!nextCursor)return;
    const folder=elem('folder') as HTMLSelectElement|null;
    const query=elem('query') as HTMLInputElement|null;
    const args:Record<string,unknown>={...origin,limit:5};
    if(!more){delete args.cursor;
      if(kind==='messages'&&folder)args.folder=folder.value;
      if(kind!=='boxes'){const term=query?.value.trim()??'';
        if(term.length>240){status('Recherche trop longue.');return;}
        if(term)args.query=term;else delete args.query;}}
    else args.cursor=nextCursor;
    const prior=nextCursor,token=++serial;interactive=true;busy=true;controls();
    try{const response=await app.callServerTool({name:`messaging_${listName[kind]}`,arguments:args});
      if(token!==serial||!root?.isConnected)return;
      const parsed=page(response,kind);
      if(!parsed||more&&parsed.nextCursor===prior){status('Page refusée ou curseur inchangé.');return;}
      items=parsed.items;nextCursor=parsed.nextCursor;origin=args;selected=null;render();status('Page chargée.');
    }catch{status('Lecture indisponible.');}
    finally{if(token===serial){busy=false;controls();}}
  }
  async function read(item:Row){
    if(kind==='boxes'||!tools||busy||!validId(item.id)||!validId(item.boxId))return;
    const token=++serial;busy=true;controls();
    try{const response=await app.callServerTool({name:`messaging_${readName[kind]}`,
      arguments:{boxId:item.boxId,[kind==='messages'?'messageId':'draftId']:item.id}});
      if(token!==serial||!root?.isConnected)return;
      const loaded=detail(response,kind,item.id);
      if(!loaded||Number(loaded.revision)<Number(item.revision)){
        status('Lecture refusée ou version obsolète.');return;}
      selected=loaded;render();status('Détail relu.');
    }catch{status('Lecture indisponible.');}
    finally{if(token===serial){busy=false;controls();}}
  }
  elem('refresh')?.addEventListener('click',()=>void list(false));
  elem('more')?.addEventListener('click',()=>void list(true));
  elem('search')?.addEventListener('click',()=>void list(false));
}
export const startBoxes=()=>{void mountMessagingWidget('boxes');};
export const startMessages=()=>{void mountMessagingWidget('messages');};
export const startDrafts=()=>{void mountMessagingWidget('drafts');};
