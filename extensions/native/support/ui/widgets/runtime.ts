import {App,PostMessageTransport} from '@modelcontextprotocol/ext-apps';

type Audience='admin'|'app'|'unknown';
type Ticket={id:string;requesterId:string;subject:string;status:string;assignedTo:string|null;
  createdAt:string;updatedAt:string;lastMessageAt:string|null;lastPreview:string|null;
  messageCount:number;revision:number};
type Message={id:string;ticketId:string;origin:'client'|'support';authorId:string;body:string;createdAt:string};
const ticketStatus:Record<string,string>={ouvert:'Ouvert',repondu:'Répondu',resolu:'Résolu',ferme:'Fermé'};
const byId=(name:string)=>document.getElementById(name);
const button=(name:string)=>byId(name) as HTMLButtonElement|null;
const input=(name:string)=>byId(name) as HTMLInputElement|HTMLTextAreaElement|null;
const say=(message:string)=>{const status=byId('status');if(status)status.textContent=message;};
const id=(value:unknown):value is string=>typeof value==='string'&&value.length>=1&&value.length<=128;
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const unwrap=(value:unknown):unknown=>{
  if(!record(value))return value;
  if(value.kind==='creezio.widget.render.v1')return value.input;
  if(value.kind==='creezio.widget.action.v1'&&value.state==='succeeded')return value.output;
  return value;
};
function parseTicket(value:unknown):Ticket|null{
  if(!record(value)||!id(value.id)||!id(value.requesterId)||typeof value.subject!=='string'||
    !value.subject||value.subject.length>240||typeof value.status!=='string'||
    !Object.hasOwn(ticketStatus,value.status)||!(value.assignedTo===null||id(value.assignedTo))||
    !Number.isSafeInteger(value.revision)||Number(value.revision)<1||
    !Number.isSafeInteger(value.messageCount)||Number(value.messageCount)<0||
    typeof value.createdAt!=='string'||typeof value.updatedAt!=='string'||
    !(value.lastPreview===null||typeof value.lastPreview==='string'&&value.lastPreview.length<=240)||
    !(value.lastMessageAt===null||typeof value.lastMessageAt==='string'))return null;
  return value as Ticket;
}
function parseTicketOutput(value:unknown):Ticket|null{
  const body=unwrap(value);return record(body)?parseTicket(body.item):null;
}
function parseTicketPage(value:unknown):{items:Ticket[];nextCursor:string|null}|null{
  const body=unwrap(value);if(!record(body)||!Array.isArray(body.items)||body.items.length>25||
    !(body.nextCursor===null||typeof body.nextCursor==='string'&&body.nextCursor.length<=2048))return null;
  const items=body.items.map(parseTicket);return items.every(Boolean)?
    {items:items as Ticket[],nextCursor:body.nextCursor as string|null}:null;
}
function parseMessage(value:unknown):Message|null{
  if(!record(value)||!id(value.id)||!id(value.ticketId)||!id(value.authorId)||
    !['client','support'].includes(String(value.origin))||typeof value.body!=='string'||
    value.body.length<1||value.body.length>4000||typeof value.createdAt!=='string')return null;
  return value as Message;
}
function parseMessagePage(value:unknown):{items:Message[];nextCursor:string|null}|null{
  const body=unwrap(value);if(!record(body)||!Array.isArray(body.items)||body.items.length>50||
    !(body.nextCursor===null||typeof body.nextCursor==='string'&&body.nextCursor.length<=2048))return null;
  const items=body.items.map(parseMessage);return items.every(Boolean)?
    {items:items as Message[],nextCursor:body.nextCursor as string|null}:null;
}
const node=(tag:string,className?:string,value?:string)=>{
  const result=document.createElement(tag);if(className)result.className=className;
  if(value!==undefined)result.textContent=value;return result;
};
function audienceOf(value:unknown):Audience{
  if(!record(value)||!record(value.instance))return 'unknown';
  return value.instance.audience==='app'?'app':value.instance.audience==='admin'?'admin':'unknown';
}
function resultOf(value:unknown):unknown{
  return record(value)&&value.isError===true?null:
    record(value)&&Object.hasOwn(value,'structuredContent')?value.structuredContent:value;
}
function succeeded(value:unknown):unknown{
  const body=resultOf(value);
  if(!record(body))return null;
  if(body.kind==='creezio.widget.render.v1')return body.input;
  return body.kind==='creezio.widget.action.v1'&&body.state==='succeeded'?body.output:null;
}
const tool=(name:string,args:Record<string,unknown>)=>({name:`support_${name}`,arguments:args});

/** Result callbacks never dispatch. Every query or command below follows a deliberate click. */
export async function mountSupportWidget(kind:'list'|'thread',audience:'admin'|'app'):Promise<void>{
  const root=byId('support-widget');if(!root)return;
  const app=new App({name:`Creezio Support ${kind}`,version:'0.1.0'},{});
  let tools=false,ready=false,interactive=false,reading=false,commanding=false,uncertain=false,serial=0,external=false;
  let tickets:Ticket[]=[],ticket:Ticket|null=null,messages:Message[]=[],threadTicketId:string|null=null;
  let ticketCursor:string|null=null,messageCursor:string|null=null,query='',limit=10;
  let initialMessageTicketId:string|null=null;
  let statusFilter:string|null=null,pageOrigin=false;
  const externalJournalPrefix=`creezio.support.widget.pending.v1.${audience}.`;
  const hasExternalPending=():boolean=>{
    for(let index=0;index<sessionStorage.length;index++)
      if(sessionStorage.key(index)?.startsWith(externalJournalPrefix))return true;
    return false;
  };
  const clearExternalPending=(key:string,value:string):boolean=>{
    if(!external)return true;
    try{if(sessionStorage.getItem(key)!==value)return false;
      sessionStorage.removeItem(key);return sessionStorage.getItem(key)===null;}catch{return false;}
  };
  const controls=()=>{
    const busy=reading||commanding;
    if(button('list'))button('list')!.disabled=!tools||!ready||busy;
    if(button('more'))button('more')!.disabled=!tools||!ready||busy||
      (kind==='list'?(!ticketCursor||!pageOrigin):!messageCursor);
    if(button('refresh'))button('refresh')!.disabled=!tools||!ready||busy||!threadTicketId;
    if(button('messages-load'))button('messages-load')!.disabled=!tools||!ready||busy||!threadTicketId;
    if(button('messages-more'))button('messages-more')!.disabled=!tools||!ready||busy||!messageCursor;
    if(button('create'))button('create')!.disabled=!tools||!ready||busy||uncertain||audience==='admin';
    if(button('send'))button('send')!.disabled=!tools||!ready||busy||uncertain||!ticket;
  };
  const render=()=>{
    if(kind==='list'){
      const target=byId('results');if(target){target.replaceChildren();
        for(const item of tickets){
          const card=node('article','ticket');card.appendChild(node('strong',undefined,item.subject));
          card.appendChild(node('p',undefined,`${ticketStatus[item.status]} · ${item.messageCount} message(s)`));
          if(item.lastPreview)card.appendChild(node('p',undefined,item.lastPreview));
          const open=node('button',undefined,'Ouvrir le ticket') as HTMLButtonElement;
          open.type='button';open.disabled=!tools||reading||commanding;
          open.addEventListener('click',()=>{interactive=true;void readTicket(item.id);});
          card.appendChild(open);target.appendChild(card);
        }
        if(!tickets.length&&!threadTicketId)target.appendChild(node('p',undefined,'Aucun ticket dans ce résultat.'));
      }
      const opened=byId('opened');if(opened)opened.hidden=!(ticket||threadTicketId);
      if(byId('opened-title'))byId('opened-title')!.textContent=ticket?.subject??'Fil du ticket';
      if(byId('opened-meta'))byId('opened-meta')!.textContent=ticket?
        `${ticketStatus[ticket.status]} · ${ticket.messageCount} message(s)`:'';
      const thread=byId('messages');if(thread){thread.replaceChildren();
        for(const item of messages){const row=node('article',`message ${item.origin==='support'?'agent':''}`);
          row.appendChild(node('small','meta',item.origin==='support'?'Équipe support':'Demandeur'));
          row.appendChild(node('div',undefined,item.body));thread.appendChild(row);}
        if(!messages.length&&threadTicketId)thread.appendChild(node('p',undefined,'Aucun message dans ce fil.'));
      }
      const creation=byId('create-panel');if(creation)creation.hidden=audience==='admin';
    }else{
      if(byId('subject'))byId('subject')!.textContent=ticket?.subject??'Fil du ticket';
      if(byId('ticket-meta'))byId('ticket-meta')!.textContent=ticket?
        `${ticketStatus[ticket.status]} · ${ticket.messageCount} message(s)`:'';
      const target=byId('messages');if(target){target.replaceChildren();
        for(const item of messages){const row=node('article',`message ${item.origin==='support'?'agent':''}`);
          row.appendChild(node('small','meta',item.origin==='support'?'Équipe support':'Demandeur'));
          row.appendChild(node('div',undefined,item.body));target.appendChild(row);}
        if(!messages.length)target.appendChild(node('p',undefined,'Lisez le fil pour afficher les messages.'));
      }
      if(button('send'))button('send')!.textContent=audience==='admin'?'Répondre comme agent':'Enregistrer la réponse';
    }
    controls();
  };
  const callRead=async(name:string,args:Record<string,unknown>):Promise<unknown>=>{
    const token=++serial;reading=true;controls();
    try {const result=await app.callServerTool(tool(name,args));
      if(token!==serial)return null;return succeeded(result);
    }catch{return null;}finally{if(token===serial){reading=false;controls();}}
  };
  async function readTicket(ticketId:string){
    if(!tools||reading||commanding||!id(ticketId))return;
    const result=await callRead(kind==='list'?`ticket_open_${audience}`:
      audience==='admin'?'ticket_read_admin':'ticket_read',{id:ticketId});
    const next=parseTicketOutput(result);if(!next||next.id!==ticketId){say('Lecture refusée ou indisponible.');return;}
    ticket=next;threadTicketId=next.id;messages=[];messageCursor=null;render();say('Ticket relu.');
    if(kind==='list')await loadMessages();
  }
  const loadTickets=async(more=false)=>{
    if(!tools||reading||commanding||more&&(!ticketCursor||!pageOrigin))return;
    const requestedQuery=more?query:(input('query')?.value??'').trim();
    if(requestedQuery.length>120){say('Recherche trop longue.');return;}
    const args:Record<string,unknown>={limit};
    if(requestedQuery)args.query=requestedQuery;
    if(more&&statusFilter)args.status=statusFilter;
    if(more)args.cursor=ticketCursor;
    const result=await callRead(audience==='admin'?'ticket_list_admin':'ticket_list',args);
    const page=parseTicketPage(result);
    if(!page||more&&page.nextCursor===ticketCursor){say('Page indisponible ou curseur inchangé.');return;}
    tickets=page.items;ticketCursor=page.nextCursor;query=requestedQuery;
    if(!more)statusFilter=null;pageOrigin=true;render();say('Page de tickets chargée.');
  };
  const loadMessages=async(more=false)=>{
    if(!tools||reading||commanding||!threadTicketId||more&&!messageCursor)return;
    const current=threadTicketId,previous=messageCursor;
    const name=kind==='list'?`message_list_${audience}_list`:
      audience==='admin'?'message_list_admin':'message_list';
    const result=await callRead(name,
      {ticketId:current,limit:20,...(more?{cursor:previous}:{})});
    const page=parseMessagePage(result);
    if(!page||threadTicketId!==current||page.items.some(item=>item.ticketId!==current)||
      more&&page.nextCursor===previous){say('Fil indisponible ou curseur inchangé.');return;}
    messages=more?[...messages,...page.items].slice(-50):page.items;
    messageCursor=page.nextCursor;render();say('Messages relus.');
  };
  const callCommand=async(name:string,args:Record<string,unknown>,accept:(value:unknown)=>boolean)=>{
    if(!tools||reading||commanding||uncertain)return;
    commanding=true;controls();say('Commande en cours…');
    // Native Creezio host persists its own request key before invoke. External MCP hosts
    // receive this UUID; their iframe also records it before dispatch or refuses to send.
    const requestKey=crypto.randomUUID();
    const journalKey=`${externalJournalPrefix}${requestKey}`;
    const journalValue=JSON.stringify({requestKey,operation:name});
    if(external){
      try{
        if(hasExternalPending()){uncertain=true;commanding=false;controls();
          say('Une commande attend une vérification de statut.');return;}
        sessionStorage.setItem(journalKey,journalValue);
        if(sessionStorage.getItem(journalKey)!==journalValue)throw new Error('journal_unavailable');
      }
      catch{commanding=false;controls();say('Journal indisponible : commande non envoyée.');return;}
    }
    try {const result=await app.callServerTool(tool(name,{...args,requestKey}));
      const output=succeeded(result);
      if(output&&accept(output)){
        if(!clearExternalPending(journalKey,journalValue))uncertain=true;
        say(uncertain?'Commande confirmée, mais clé conservée : vérifiez le statut.':
          'Commande enregistrée. Relisez le ticket pour confirmer l’état courant.');
      }
      else if(record(result.structuredContent)&&result.structuredContent.kind==='creezio.widget.action.v1'&&
        result.structuredContent.state==='rejected'){
        if(!clearExternalPending(journalKey,journalValue))uncertain=true;
        say(uncertain?'Commande refusée, mais clé conservée : vérifiez le statut.':
          'Commande refusée. Relisez le ticket avant de réessayer.');
      }
      else{uncertain=true;say('Résultat incertain. Vérifiez le statut dans le chat avant toute autre commande.');}
    }catch{uncertain=true;say('Résultat incertain. Vérifiez le statut dans le chat avant toute autre commande.');}
    finally{commanding=false;render();}
  };
  const create=async()=>{
    if(audience==='admin')return;
    const subject=(input('subject')?.value??'').trim(),body=(input('body')?.value??'').trim();
    if(!subject||subject.length>240||body.length>4000){say('Sujet ou message invalide.');return;}
    await callCommand('ticket_create',{subject,...(body?{body}:{})},value=>{
      const created=parseTicketOutput(value);if(!created)return false;
      ticket=created;threadTicketId=created.id;ticketCursor=null;
      input('subject')!.value='';input('body')!.value='';return true;
    });
  };
  const send=async()=>{
    if(!ticket)return;
    const body=(input('reply')?.value??'').trim();if(!body||body.length>4000){say('Réponse invalide.');return;}
    const current=ticket,command=audience==='admin'?'message_reply':'message_customer';
    await callCommand(command,{ticketId:current.id,revision:current.revision,body},value=>{
      const output=unwrap(value);if(!record(output)||!parseMessage(output.item))return false;
      const updated=parseTicket(output.ticket);
      if(!updated||updated.id!==current.id)return false;
      if(ticket?.id===updated.id&&updated.revision>=ticket.revision){ticket=updated;messages=[];messageCursor=null;}
      if(input('reply')?.value===body)input('reply')!.value='';return true;
    });
  };
  app.addEventListener('toolinput',value=>{
    if(!record(value)||!record(value.arguments)||interactive)return;
    const args=value.arguments;
    initialMessageTicketId=id(args.ticketId)?args.ticketId:null;
    if(kind==='thread'&&id(args.ticketId))threadTicketId=args.ticketId;
    if(kind==='list'&&!initialMessageTicketId&&Number.isInteger(args.limit)&&Number(args.limit)>=1&&
      Number(args.limit)<=25&&(!Object.hasOwn(args,'query')||typeof args.query==='string'&&args.query.length<=120)&&
      (!Object.hasOwn(args,'status')||typeof args.status==='string'&&Object.hasOwn(ticketStatus,args.status))){
      limit=Number(args.limit);query=typeof args.query==='string'?args.query:'';
      statusFilter=typeof args.status==='string'?args.status:null;pageOrigin=true;
      if(input('query'))input('query')!.value=query;
    }
  });
  app.addEventListener('toolresult',value=>{
    if(interactive)return;
    const body=resultOf(value);const detected=audienceOf(body);
    if(detected!=='unknown'&&detected!==audience){say('Audience du résultat incompatible.');return;}
    if(record(body)&&record(body.instance)&&body.instance.host==='external-mcp'){
      external=true;
      try{if(hasExternalPending())uncertain=true;}
      catch{uncertain=true;}
    }
    let accepted=false;
    if(kind==='list'){
      const page=parseTicketPage(body),opened=parseTicketOutput(body),thread=parseMessagePage(body);
      if(thread&&initialMessageTicketId&&
        thread.items.every(message=>message.ticketId===initialMessageTicketId)){
        threadTicketId=initialMessageTicketId;messages=thread.items;
        messageCursor=thread.nextCursor;accepted=true;
      }
      else if(page){tickets=page.items;ticketCursor=page.nextCursor;accepted=true;}
      else if(opened){ticket=opened;threadTicketId=opened.id;accepted=true;}
      else if(thread&&!initialMessageTicketId&&
        (!thread.items.length||thread.items.every(message=>message.ticketId===thread.items[0].ticketId))){
        const candidate=thread.items[0]?.ticketId??threadTicketId;
        if(candidate){threadTicketId=candidate;messages=thread.items;messageCursor=thread.nextCursor;accepted=true;}
      }
    }else {
      const item=parseTicketOutput(body),page=parseMessagePage(body);
      const payload=unwrap(body);
      const response=record(payload)&&record(payload.ticket)&&record(payload.item)?
        {ticket:parseTicket(payload.ticket),message:parseMessage(payload.item)}:null;
      if(item){ticket=item;threadTicketId=item.id;accepted=true;}
      else if(response?.ticket&&response.message&&response.message.ticketId===response.ticket.id){
        ticket=response.ticket;threadTicketId=response.ticket.id;messages=[response.message];messageCursor=null;accepted=true;
      }
      else if(page&&(!page.items.length||page.items.every(message=>message.ticketId===page.items[0].ticketId))){
        const candidate=page.items[0]?.ticketId??threadTicketId;
        if(candidate){threadTicketId=candidate;messages=page.items;messageCursor=page.nextCursor;accepted=true;}
      }
    }
    if(accepted)ready=true;
    render();
    if(kind==='list'&&ticketCursor&&!pageOrigin&&tools)
      say('Suite disponible : actualisez la liste pour retrouver ses filtres avant de paginer.');
  });
  button('list')?.addEventListener('click',()=>{interactive=true;void loadTickets();});
  button('more')?.addEventListener('click',()=>{interactive=true;void (kind==='list'?loadTickets(true):loadMessages(true));});
  button('refresh')?.addEventListener('click',()=>{interactive=true;if(threadTicketId)void readTicket(threadTicketId);});
  button('messages-load')?.addEventListener('click',()=>{interactive=true;void loadMessages();});
  button('messages-more')?.addEventListener('click',()=>{interactive=true;void loadMessages(true);});
  button('create')?.addEventListener('click',()=>{interactive=true;void create();});
  button('send')?.addEventListener('click',()=>{interactive=true;void send();});
  render();
  try {await app.connect(new PostMessageTransport(window.parent,window.parent));tools=!!app.getHostCapabilities()?.serverTools;
    render();if(!tools)say('Lecture seule : les actions directes sont indisponibles dans cet hôte.');
    else if(kind==='list'&&ticketCursor&&!pageOrigin)
      say('Suite disponible : actualisez la liste pour retrouver ses filtres avant de paginer.');}
  catch{say('Hôte indisponible. Le résultat historique reste lisible.');}
}

export const startAppList=()=>{void mountSupportWidget('list','app');};
export const startAdminList=()=>{void mountSupportWidget('list','admin');};
export const startAppThread=()=>{void mountSupportWidget('thread','app');};
export const startAdminThread=()=>{void mountSupportWidget('thread','admin');};
