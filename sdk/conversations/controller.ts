import type {OperationClientResult} from '../operations/client.ts';
import {readJson} from '../operations/protocol.ts';
import {validWidgetMessageContent} from '../widgets/validation.ts';
import type {ConversationActionResult, ConversationAttachment, ConversationDraft, ConversationEvent, ConversationMessage, ConversationPage,
  ConversationsController, ConversationsControllerOptions, ConversationsSnapshot, ConversationSummary, ConversationTurn,
  WidgetContextView} from './types.ts';

type JsonObject=Record<string,unknown>;
const object=(value:unknown):JsonObject|null=>value&&typeof value==='object'&&!Array.isArray(value)?value as JsonObject:null;
const id=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
const text=(value:unknown,max:number):value is string=>typeof value==='string'&&value.length<=max&&value.isWellFormed();
const summary=(value:unknown)=>{const row=object(value);return !!row&&id(row.id)&&text(row.title,240)
  &&['chat','work'].includes(String(row.mode))&&text(row.updatedAt,35)
  &&(row.archivedAt===null||text(row.archivedAt,35))&&Number.isSafeInteger(row.revision);};
const message=(value:unknown)=>{const row=object(value);return !!row&&id(row.id)&&id(row.conversationId)
  &&['user','assistant','tool','system'].includes(String(row.role))&&text(row.body,16000)
  &&text(row.createdAt,35)&&Number.isSafeInteger(row.revision)
  &&(row.content===undefined||row.content===null||validWidgetMessageContent(row.content));};
const widgetContext=(value:unknown):value is WidgetContextView=>{const row=object(value);return !!row
  &&id(row.instanceId)&&row.namespace==='module-instance'&&Number.isSafeInteger(row.revision)
  &&Number(row.revision)>=1&&text(row.expiresAt,35)&&typeof row.removed==='boolean';};
const attachment=(value:unknown)=>{const row=object(value),reference=object(row?.reference);return !!row
  &&id(row.fileId)&&id(row.conversationId)&&text(row.filename,255)&&text(row.contentType,128)
  &&Number.isSafeInteger(row.byteSize)&&Number(row.byteSize)>=0&&text(row.createdAt,35)
  &&!!reference&&reference.fileId===row.fileId&&id(reference.intentId)&&id(reference.generation)
  &&typeof reference.digest==='string'&&/^[0-9a-f]{64}$/i.test(reference.digest);};
const turn=(value:unknown):value is ConversationTurn=>{const row=object(value);return !!row&&id(row.id)
  &&id(row.conversationId)&&['queued','running','succeeded','failed','cancel_requested','cancelled','no_provider','unknown'].includes(String(row.state))
  &&(row.providerId===null||id(row.providerId))&&text(row.updatedAt,35)
  &&Number.isSafeInteger(row.lastSequence)&&Number(row.lastSequence)>=0
  &&(row.errorCode===null||text(row.errorCode,128))&&Number.isSafeInteger(row.revision)&&Number(row.revision)>=1;};
function validOutput(name:string,value:JsonObject):boolean {
  try{if(JSON.stringify(value).length>262144)return false;}catch{return false;}
  if(['conversation.list','conversation.search'].includes(name))return Array.isArray(value.items)&&value.items.length<=50
    &&value.items.every(summary)&&(value.nextCursor===null||text(value.nextCursor,2048));
  if(['conversation.create','conversation.rename','conversation.archive','conversation.restore'].includes(name))return summary(value.conversation);
  if(name==='conversation.read')return summary(value.conversation)&&['no_provider','configured'].includes(String(value.provider));
  if(name==='message.list')return Array.isArray(value.items)&&value.items.length<=1&&value.items.every(message)
    &&(value.nextCursor===null||text(value.nextCursor,2048));
  if(name==='message.add')return message(value.message);
  if(['widget.context.read','widget.context.replace','widget.context.remove'].includes(name))
    return Object.hasOwn(value,'context')&&(value.context===null||widgetContext(value.context));
  if(['draft.read','draft.save'].includes(name))return id(value.conversationId)&&text(value.text,16000)
    &&(value.updatedAt===null||text(value.updatedAt,35))&&Number.isSafeInteger(value.revision);
  if(['turn.read','turn.cancel'].includes(name))return value.turn===null||turn(value.turn);
  if(name==='turn.start')return message(value.message)&&turn(value.turn)
    &&object(value.message)?.conversationId===object(value.turn)?.conversationId;
  if(name==='event.list')return Array.isArray(value.items)&&value.items.length<=50
    &&value.items.every(item=>Number.isSafeInteger(object(item)?.sequence)&&id(object(item)?.turnId))
    &&(value.nextSequence===null||Number.isSafeInteger(value.nextSequence));
  if(name==='attachment.link')return id(value.fileId)&&id(value.conversationId);
  if(name==='attachment.list')return Array.isArray(value.items)&&value.items.length<=50
    &&value.items.every(attachment)&&(value.nextCursor===null||text(value.nextCursor,2048));
  return false;
}
const binding=(audience:'admin'|'app',name:string)=>`creezio.conversations:${audience}.${name}`;
const empty:ConversationsSnapshot=Object.freeze({phase:'loading',provider:'no_provider',conversations:Object.freeze([]),
  nextCursor:null,selected:null,messages:Object.freeze([]),messagesNextCursor:null,draft:null,
  activeTurn:null,turnEvents:Object.freeze([]),searchQuery:'',archived:false,pending:false,
  unknown:null,error:null});

/** Stitch a server-ordered newest slice onto a locally loaded chronological window. */
export function mergeRecentMessages(existing:readonly ConversationMessage[], recentNewestFirst:readonly ConversationMessage[]){
  const merged=[...existing],recent=[...recentNewestFirst].reverse();
  for(let index=0;index<recent.length;index++){
    const item=recent[index],found=merged.findIndex(row=>row.id===item.id);
    if(found>=0){if(item.revision>merged[found].revision)merged[found]=item;continue;}
    let insertion=merged.length;
    for(let next=index+1;next<recent.length;next++){
      const position=merged.findIndex(row=>row.id===recent[next].id);
      if(position>=0){insertion=position;break;}
    }
    if(insertion===merged.length){
      for(let prior=index-1;prior>=0;prior--){
        const position=merged.findIndex(row=>row.id===recent[prior].id);
        if(position>=0){insertion=position+1;break;}
      }
    }
    merged.splice(insertion,0,item);
  }
  return merged;
}

/** Host-bound conversation state; themes receive only the rendered view. */
export function createConversationsController(options:ConversationsControllerOptions):ConversationsController {
  if(!options||options.access.audience!==options.audience||!id(options.contextId))
    throw new TypeError('Invalid conversation controller scope.');
  const listeners=new Set<()=>void>();
  let snapshot=empty, disposed=false, active=options.active??false,
    generation=0, listGeneration=0, openGeneration=0, turnRefreshGeneration=0,
    identity='',restoreSelection:string|null=null;
  let queryFailure:{bindingId:string;code:string}|null=null;
  const localDrafts=new Map<string,string>();
  const turnIds=new Map<string,string>();
  const driveRequests=new Set<AbortController>();
  const cache=new Map<string,ConversationSummary>();
  let storage:Storage|null=null;
  try {storage=globalThis.sessionStorage;}catch{/* optional browser persistence */}
  const scope=()=>{
    const state=options.access.getSnapshot(),session=state.session;
    return state.phase==='authenticated'&&session?`${session.id}:${session.principalId}:${options.audience}:${options.contextId}`:'';
  };
  const storageKey=(name:string)=>`creezio.conversations.v1:${identity}:${name}`;
  let resumeQueued=false,resumeOpenGeneration=0;
  const resumeIncompleteSelection=()=>{
    if(!active||snapshot.phase!=='ready'||!identity)return;
    const selectedId=snapshot.selected?.id??restoreSelection;
    if(!selectedId||snapshot.draft?.conversationId===selectedId)return;
    resumeOpenGeneration=openGeneration;
    if(resumeQueued)return;
    resumeQueued=true;
    queueMicrotask(()=>{
      resumeQueued=false;
      if(disposed||!active||snapshot.phase!=='ready'||scope()!==identity
        ||openGeneration!==resumeOpenGeneration)return;
      const wanted=snapshot.selected?.id??restoreSelection;
      if(wanted&&snapshot.draft?.conversationId!==wanted)void controller.open(wanted);
    });
  };
  const update=(change:Partial<ConversationsSnapshot>)=>{
    if(disposed)return;
    snapshot=Object.freeze({...snapshot,...change});
    for(const listener of listeners)listener();
  };
  const clear=()=>{
    for(const request of driveRequests)request.abort();driveRequests.clear();
    const old=identity;
    if(old&&storage)try{
      for(let index=storage.length-1;index>=0;index--){const key=storage.key(index);
        if(key?.startsWith(`creezio.conversations.v1:${old}:`))storage.removeItem(key);}
    }catch{/* optional storage */}
    identity='';restoreSelection=null;queryFailure=null;localDrafts.clear();turnIds.clear();cache.clear();generation++;listGeneration++;openGeneration++;turnRefreshGeneration++;
    update({...empty,phase:'anonymous'});
  };
  const purgeAuthorized=(code:string)=>{
    for(const request of driveRequests)request.abort();driveRequests.clear();
    const old=identity;
    if(old&&storage)try{for(let index=storage.length-1;index>=0;index--){const name=storage.key(index);
      if(name?.startsWith(`creezio.conversations.v1:${old}:`))storage.removeItem(name);}}catch{}
    restoreSelection=null;queryFailure=null;localDrafts.clear();turnIds.clear();cache.clear();generation++;listGeneration++;openGeneration++;turnRefreshGeneration++;
    update({...empty,phase:'ready',error:code});
    void options.access.refresh().catch(()=>{});
  };
  const observe=()=>{
    const access=options.access.getSnapshot(),current=scope();
    if(access.phase==='anonymous'){clear();return;}
    if(access.phase==='unavailable'){update({phase:'unavailable',pending:false});return;}
    if(access.phase==='loading'||access.pending){
      if(snapshot.phase!=='loading'){generation++;listGeneration++;openGeneration++;}
      update({phase:'loading',pending:false});return;
    }
    if(!current){clear();return;}
    if(identity!==current){
      identity=current;queryFailure=null;localDrafts.clear();turnIds.clear();cache.clear();generation++;listGeneration++;openGeneration++;
      update({...empty,phase:'ready'});
      try {const raw=storage?.getItem(storageKey('unknown'));const pending=raw&&object(JSON.parse(raw));
        if(pending&&typeof pending.bindingId==='string'&&typeof pending.requestKey==='string'&&typeof pending.code==='string')
          update({unknown:{bindingId:pending.bindingId,requestKey:pending.requestKey,code:pending.code}});
      }catch{/* malformed optional state */}
      try {const remembered=storage?.getItem(storageKey('selected'));
        restoreSelection=id(remembered)?remembered:null;}catch{restoreSelection=null;}
      resumeIncompleteSelection();
    } else if(snapshot.phase!=='ready'){
      update({phase:'ready'});resumeIncompleteSelection();
    }
  };
  const unsubscribe=options.access.subscribe(observe);observe();
  const current=(stamp:number)=>!disposed&&active&&stamp===generation&&snapshot.phase==='ready'&&scope()===identity;
  async function invoke(name:string,args:JsonObject,command=false,stillCurrent:()=>boolean=()=>true):Promise<ConversationActionResult<JsonObject>> {
    const stamp=generation, requestKey=command?crypto.randomUUID():undefined;
    const bindingId=binding(options.audience,name);
    if(command&&(snapshot.pending||snapshot.unknown))return {kind:'rejected',code:'pending_resolution'};
    if(!current(stamp)||!stillCurrent())return {kind:'rejected',code:'stale'};
    const showQueryError=(code:string)=>{
      if(snapshot.pending||snapshot.unknown||snapshot.error!==null&&!queryFailure)return;
      queryFailure={bindingId,code};update({error:code});
    };
    if(command){
      queryFailure=null;
      const unknown={bindingId,requestKey:requestKey!,code:'pending'};
      update({pending:true,unknown,error:null});
      try{storage?.setItem(storageKey('unknown'),JSON.stringify(unknown));}catch{/* pending remains in memory */}
    }
    const response=await options.client.invoke({bindingId,contextId:options.contextId,
      input:command?{...args,requestKey}:args,isCurrent:()=>current(stamp)&&stillCurrent()});
    if(!current(stamp)||!stillCurrent())return {kind:'unknown',code:'stale',requestKey:requestKey??''};
    if(response.kind==='execution'&&(response.execution.state==='succeeded'
      ||name==='turn.start'&&response.execution.state==='waiting')){
      const output=object(response.execution.output);
      if(!output||!validOutput(name,output)){
        if(command){const unknown={bindingId,requestKey:requestKey!,code:'invalid_output'};
          update({pending:false,unknown,error:'invalid_output'});
          try{storage?.setItem(storageKey('unknown'),JSON.stringify(unknown));}catch{}}
        else showQueryError('invalid_output');
        return {kind:'unknown',code:'invalid_output',requestKey:requestKey??''};
      }
      if(command){update({pending:false,unknown:null,error:null});try{storage?.removeItem(storageKey('unknown'));}catch{}}
      else if(queryFailure?.bindingId===bindingId){
        const prior=queryFailure;queryFailure=null;
        if(snapshot.error===prior.code&&!snapshot.pending&&!snapshot.unknown)update({error:null});
      }
      return {kind:'ok',value:output};
    }
    if(response.kind==='rejected'){
      if(['forbidden','unauthorized'].includes(response.code)){purgeAuthorized(response.code);return {kind:'rejected',code:response.code};}
      if(command){update({pending:false,unknown:null,error:response.code});try{storage?.removeItem(storageKey('unknown'));}catch{}}
      else showQueryError(response.code);
      return {kind:'rejected',code:response.code};
    }
    if(response.kind==='execution'&&response.execution.state==='failed'){
      const code=response.execution.errorCode??'failed';
      if(command){update({pending:false,unknown:null,error:code});try{storage?.removeItem(storageKey('unknown'));}catch{}}
      else showQueryError(code);
      return {kind:'rejected',code};
    }
    const code=response.kind==='unknown'?response.code:response.execution.state;
    if(command){const unknown={bindingId,requestKey:requestKey!,code};update({pending:false,unknown,error:code});
      try{storage?.setItem(storageKey('unknown'),JSON.stringify(unknown));}catch{}}
    else showQueryError(code);
    return {kind:'unknown',code,requestKey:requestKey??''};
  }
  const query=async(name:string,args:JsonObject,stillCurrent?:()=>boolean):Promise<JsonObject|null>=>{
    const result=await invoke(name,args,false,stillCurrent);return result.kind==='ok'?result.value:null;
  };
  const advanceRevision=(conversationId:string)=>{
    const prior=cache.get(conversationId);if(!prior)return;
    const next=Object.freeze({...prior,revision:prior.revision+1});cache.set(conversationId,next);
    update({selected:snapshot.selected?.id===conversationId?next:snapshot.selected,
      conversations:Object.freeze(snapshot.conversations.map(item=>item.id===conversationId?next:item))});
  };
  async function list(args:{query?:string;cursor?:string|null;limit?:number;archived?:boolean},append:boolean):Promise<ConversationPage<ConversationSummary>|null>{
    const stamp=generation, serial=++listGeneration;
    const searchQuery=args.query??'', archived=args.archived??false;
    if(append&&(snapshot.searchQuery!==searchQuery||snapshot.archived!==archived||snapshot.nextCursor!==args.cursor))return null;
    const name=args.query?'conversation.search':'conversation.list';
    const result=await query(name,{limit:args.limit??25,...(args.cursor?{cursor:args.cursor}:{}),
      ...(args.query?{query:args.query}:{}),...(args.archived===undefined?{}:{archived:args.archived})},()=>serial===listGeneration);
    const items=Array.isArray(result?.items)?result.items.filter(item=>id(object(item)?.id)) as ConversationSummary[]:null;
    if(!current(stamp)||serial!==listGeneration||!items||result?.nextCursor!==null&&typeof result?.nextCursor!=='string')return null;
    for(const item of items)cache.set(item.id,item);
    const page={items:Object.freeze(items),nextCursor:result.nextCursor as string|null};
    const existing=new Set<string>();
    const combined=(append?[...snapshot.conversations,...items]:items).filter(item=>{
      if(existing.has(item.id))return false;existing.add(item.id);return true;});
    update({conversations:Object.freeze(combined),nextCursor:page.nextCursor,
      searchQuery,archived,error:null});
    return page;
  }
  async function commandSummary(name:string,args:JsonObject):Promise<ConversationActionResult<ConversationSummary>>{
    const result=await invoke(name,args,true);
    if(result.kind!=='ok')return result;
    const value=object(result.value.conversation);
    if(!value||!id(value.id))return {kind:'unknown',code:'invalid_output',requestKey:''};
    const summary=value as unknown as ConversationSummary;
    cache.set(summary.id,summary);
    update({conversations:Object.freeze([summary,...snapshot.conversations.filter(item=>item.id!==summary.id)]),
      selected:snapshot.selected?.id===summary.id?summary:snapshot.selected});
    return {kind:'ok',value:summary};
  }
  const controller:ConversationsController={
    getSnapshot:()=>snapshot,
    subscribe(listener){listeners.add(listener);return()=>{listeners.delete(listener);};},
    setActive(value){
      if(disposed||active===value)return;
      if(!value){for(const request of driveRequests)request.abort();driveRequests.clear();}
      active=value;generation++;listGeneration++;openGeneration++;turnRefreshGeneration++;
      if(!active&&snapshot.pending)update({pending:false,error:'outcome_unknown'});
      if(active)resumeIncompleteSelection();
    },
    async refresh(){if(snapshot.phase!=='ready')return;await list({query:snapshot.searchQuery,archived:snapshot.archived},false);},
    async loadMore(){if(snapshot.nextCursor)await list({query:snapshot.searchQuery,archived:snapshot.archived,cursor:snapshot.nextCursor},true);},
    search:args=>list(args,false),
    async open(conversationId){
      if(!id(conversationId))return;
      const stamp=generation,serial=++openGeneration;turnRefreshGeneration++;
      const detail=await query('conversation.read',{conversationId},()=>serial===openGeneration);
      if(!current(stamp)||serial!==openGeneration)return;
      if(!detail){
        if(restoreSelection===conversationId&&snapshot.error==='not_found'){
          restoreSelection=null;try{storage?.removeItem(storageKey('selected'));}catch{}}
        return;
      }
      const item=object(detail.conversation);
      if(!item||!id(item.id))return;
      const selected=item as unknown as ConversationSummary;
      restoreSelection=null;try{storage?.setItem(storageKey('selected'),conversationId);}catch{}
      cache.set(selected.id,selected);
      update({selected,messages:Object.freeze([]),messagesNextCursor:null,draft:null,
        activeTurn:null,turnEvents:Object.freeze([]),
        provider:detail.provider==='configured'?'configured':'no_provider'});
      const [messages,draft]=await Promise.all([query('message.list',{conversationId,limit:1},()=>serial===openGeneration),
        query('draft.read',{conversationId},()=>serial===openGeneration)]);
      if(!current(stamp)||serial!==openGeneration||snapshot.selected?.id!==conversationId)return;
      const msg=Array.isArray(messages?.items)?[...messages.items as ConversationMessage[]]:[];
      let olderCursor=typeof messages?.nextCursor==='string'?messages.nextCursor:null;
      // A restored conversation has no remembered terminal turn. Load the
      // latest assistant's whole exchange so a preceding tool widget survives
      // a reload even when only the final assistant was initially visible.
      for(let page=1;page<32&&msg.length&&msg.at(-1)?.role!=='user'&&olderCursor;page++){
        const cursor=olderCursor;
        const older=await query('message.list',{conversationId,limit:1,cursor},
          ()=>serial===openGeneration&&snapshot.selected?.id===conversationId);
        if(!current(stamp)||serial!==openGeneration||snapshot.selected?.id!==conversationId)return;
        if(!Array.isArray(older?.items)||!older.items.length)break;
        msg.push((older.items as ConversationMessage[])[0]);
        olderCursor=typeof older.nextCursor==='string'?older.nextCursor:null;
        if(olderCursor===cursor)break;
      }
      const storedDraft=object(draft);
      if(!storedDraft||storedDraft.conversationId!==conversationId||
        typeof storedDraft.text!=='string'||!Number.isSafeInteger(storedDraft.revision)||
        Number(storedDraft.revision)<0){
        update({messages:Object.freeze([...msg].reverse()),messagesNextCursor:olderCursor});
      }else{
        let local=localDrafts.get(conversationId);
        if(local===undefined)try{local=storage?.getItem(storageKey(`draft:${conversationId}`))??undefined;}catch{}
        update({messages:Object.freeze([...msg].reverse()),messagesNextCursor:olderCursor,
          draft:{conversationId,text:local??(storedDraft.text as string),
            updatedAt:typeof storedDraft.updatedAt==='string'?storedDraft.updatedAt:null,
            revision:storedDraft.revision as number}});
      }
      let remembered:string|null=turnIds.get(conversationId)??null;
      if(!remembered)try{const value=storage?.getItem(storageKey(`turn:${conversationId}`));remembered=id(value)?value:null;}catch{}
      if(remembered&&current(stamp)&&serial===openGeneration)await controller.refreshTurn(conversationId,remembered);
    },
    async loadMoreMessages(){
      const selected=snapshot.selected,cursor=snapshot.messagesNextCursor;
      if(!selected||!cursor)return;
      const serial=openGeneration;
      const result=await query('message.list',{conversationId:selected.id,limit:1,cursor},
        ()=>serial===openGeneration&&snapshot.selected?.id===selected.id);
      if(serial!==openGeneration||snapshot.selected?.id!==selected.id||snapshot.messagesNextCursor!==cursor
        ||!Array.isArray(result?.items))return;
      const seen=new Set(snapshot.messages.map(item=>item.id));
      const older=(result.items as ConversationMessage[]).filter(item=>{
        if(seen.has(item.id))return false;seen.add(item.id);return true;
      }).reverse();
      update({messages:Object.freeze([...older,...snapshot.messages]),
        messagesNextCursor:typeof result.nextCursor==='string'?result.nextCursor:null});
    },
    async readWidgetContext({instance,actionId}){
      if(instance.host!=='creezio'||snapshot.selected?.id!==instance.conversationId||
        !id(instance.messageId)||!id(instance.instanceId)||!id(actionId))
        return {kind:'rejected',code:'invalid_input'};
      const result=await invoke('widget.context.read',{conversationId:instance.conversationId,
        messageId:instance.messageId,instanceId:instance.instanceId,
        instanceRevision:instance.instanceRevision,actionId},false,
        ()=>snapshot.selected?.id===instance.conversationId);
      return result.kind==='ok'?{kind:'ok',value:result.value.context as WidgetContextView|null}:result;
    },
    async changeWidgetContext(request){
      const {instance,actionId}=request;
      const prior=await controller.readWidgetContext({instance,actionId});
      if(prior.kind!=='ok')return prior;
      if(request.remove&&prior.value===null)return {kind:'rejected',code:'not_found'};
      const result=await invoke(request.remove?'widget.context.remove':'widget.context.replace',{
        conversationId:instance.conversationId,messageId:instance.messageId,
        instanceId:instance.instanceId,instanceRevision:instance.instanceRevision,actionId,
        expectedRevision:prior.value?.revision??0,input:request.input},true,
        ()=>snapshot.selected?.id===instance.conversationId);
      return result.kind==='ok'?{kind:'ok',value:result.value.context as WidgetContextView|null}:result;
    },
    create:args=>commandSummary('conversation.create',args),
    rename:(conversationId,title)=>commandSummary('conversation.rename',{conversationId,title,revision:cache.get(conversationId)?.revision??0}),
    archive:conversationId=>commandSummary('conversation.archive',{conversationId,revision:cache.get(conversationId)?.revision??0}),
    restore:conversationId=>commandSummary('conversation.restore',{conversationId,revision:cache.get(conversationId)?.revision??0}),
    async addMessage(conversationId,body){
      const result=await invoke('message.add',{conversationId,id:crypto.randomUUID(),body,
        revision:cache.get(conversationId)?.revision??0},true);
      if(result.kind!=='ok')return result;
      const message=object(result.value.message);
      if(!message||!id(message.id))return {kind:'unknown',code:'invalid_output',requestKey:''};
      advanceRevision(conversationId);
      if(snapshot.selected?.id===conversationId)update({messages:Object.freeze([...snapshot.messages,message as unknown as ConversationMessage])});
      return {kind:'ok',value:message as unknown as ConversationMessage};
    },
    async startTurn(conversationId,body,modelId){
      if(snapshot.selected?.id!==conversationId||snapshot.selected.archivedAt!==null||
        snapshot.draft?.conversationId!==conversationId||!text(body,16000)
        ||!body.trim()||!id(modelId))return {kind:'rejected',code:'invalid_input'};
      const wanted=body,revision=cache.get(conversationId)?.revision??snapshot.selected.revision;
      const draftRevision=snapshot.draft.revision;
      const result=await invoke('turn.start',{conversationId,messageId:crypto.randomUUID(),body:wanted,
        revision,draftRevision,modelId},true);
      if(result.kind!=='ok')return result;
      const sent=result.value.message as unknown as ConversationMessage;
      const started=result.value.turn as unknown as ConversationTurn;
      const newer=localDrafts.get(conversationId);
      if(newer===undefined||newer===wanted){localDrafts.delete(conversationId);
        try{storage?.removeItem(storageKey(`draft:${conversationId}`));}catch{}}
      turnIds.set(conversationId,started.id);
      try{storage?.setItem(storageKey(`turn:${conversationId}`),started.id);}catch{}
      advanceRevision(conversationId);
      if(snapshot.selected?.id===conversationId){
        update({messages:Object.freeze([...snapshot.messages,sent]),activeTurn:started,turnEvents:Object.freeze([]),
          draft:{conversationId,text:newer!==undefined&&newer!==wanted?newer:'',updatedAt:null,revision:draftRevision+1}});
      }
      if(snapshot.selected?.id===conversationId)await controller.refreshTurn(conversationId,started.id);
      return {kind:'ok',value:{message:sent,turn:started}};
    },
    async driveTurn(conversationId,turnId){
      if(!id(conversationId)||!id(turnId)||snapshot.selected?.id!==conversationId)
        return {kind:'rejected',code:'invalid_input'};
      const stamp=generation,expected=scope(),selected=options.access.getSnapshot().session;
      if(!current(stamp)||!selected)return {kind:'rejected',code:'stale'};
      const fetcher=options.driveFetch??globalThis.fetch.bind(globalThis);
      const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),28000);
      driveRequests.add(abort);
      try{
        const response=await fetcher(`${options.access.origin}/api/operations/turns/${encodeURIComponent(turnId)}/drive`,{
          method:'POST',headers:{accept:'application/json','content-type':'application/json',
            'x-creezio-context':options.contextId,'x-creezio-audience':options.audience,
            'x-creezio-request':'1'},
          body:JSON.stringify({conversationId}),credentials:'same-origin',mode:'same-origin',
          redirect:'error',cache:'no-store',signal:abort.signal});
        if(!current(stamp)||scope()!==expected||options.access.getSnapshot().session?.id!==selected.id
          ||snapshot.selected?.id!==conversationId)return {kind:'unknown',code:'stale',requestKey:''};
        if(!(response instanceof Response)||response.redirected||response.url&&new URL(response.url).origin!==options.access.origin)
          return {kind:'unknown',code:'invalid_response',requestKey:''};
        const value=object(await readJson(response));
        if(!current(stamp)||scope()!==expected||options.access.getSnapshot().session?.id!==selected.id
          ||snapshot.selected?.id!==conversationId)return {kind:'unknown',code:'stale',requestKey:''};
        const driven=value?.turn;
        if(response.status===200&&turn(driven)&&driven.id===turnId
          &&driven.conversationId===conversationId){
          await controller.refreshTurn(conversationId,turnId);
          return {kind:'ok',value:driven};
        }
        const error=object(value?.error),code=error?.code;
        if(response.status>=400&&response.status<500&&typeof code==='string'&&/^[a-z][a-z0-9_]{0,63}$/.test(code)){
          if(response.status===408||response.status===499)
            return {kind:'unknown',code:'outcome_unknown',requestKey:''};
          if(['forbidden','unauthorized'].includes(code))purgeAuthorized(code);
          return {kind:'rejected',code};
        }
        return {kind:'unknown',code:'outcome_unknown',requestKey:''};
      }catch{return {kind:'unknown',code:'outcome_unknown',requestKey:''};}
      finally{clearTimeout(timer);driveRequests.delete(abort);}
    },
    async refreshTurn(conversationId,turnId){
      if(snapshot.selected?.id!==conversationId||!id(turnId))return null;
      const stamp=generation,serial=openGeneration,refreshSerial=++turnRefreshGeneration;
      const detail=await query('turn.read',{conversationId,turnId},()=>serial===openGeneration);
      if(!current(stamp)||serial!==openGeneration||refreshSerial!==turnRefreshGeneration
        ||snapshot.selected?.id!==conversationId)return null;
      const row=detail?.turn;
      if(!turn(row)){
        if(row===null){turnIds.delete(conversationId);
          try{storage?.removeItem(storageKey(`turn:${conversationId}`));}catch{}
          update({activeTurn:null,turnEvents:Object.freeze([])});}
        return null;
      }
      let events=snapshot.activeTurn?.id===turnId?[...snapshot.turnEvents]:[];
      let after=events.at(-1)?.sequence??0;
      for(let page=0;page<4;page++){
        const result=await query('event.list',{conversationId,turnId,limit:50,afterSequence:after},
          ()=>serial===openGeneration&&refreshSerial===turnRefreshGeneration&&snapshot.selected?.id===conversationId);
        if(!current(stamp)||serial!==openGeneration||refreshSerial!==turnRefreshGeneration
          ||snapshot.selected?.id!==conversationId)return null;
        if(!Array.isArray(result?.items))break;
        for(const item of result.items as ConversationEvent[])if(item.sequence>after){events.push(item);after=item.sequence;}
        if(result.nextSequence===null||!result.items.length)break;
      }
      update({activeTurn:row,turnEvents:Object.freeze(events)});
      if(!['queued','running','cancel_requested','unknown'].includes(row.state)){
        turnIds.delete(conversationId);
        try{storage?.removeItem(storageKey(`turn:${conversationId}`));}catch{}
        // A final assistant can follow a durable tool widget. Read the bounded
        // newest window through the initiating user message, one validated row
        // per page, so a reload that initially opened only the last assistant
        // does not lose the widget between them.
        const recent:ConversationMessage[]=[];
        let cursor:string|null=null,olderCursor:string|null=null;
        for(let page=0;page<32;page++){
          const messages=await query('message.list',{conversationId,limit:1,...(cursor?{cursor}:{})},
            ()=>serial===openGeneration&&refreshSerial===turnRefreshGeneration&&snapshot.selected?.id===conversationId);
          if(!current(stamp)||serial!==openGeneration||refreshSerial!==turnRefreshGeneration
            ||snapshot.selected?.id!==conversationId)return null;
          if(!Array.isArray(messages?.items)||!messages.items.length)break;
          const item=(messages.items as ConversationMessage[])[0];
          recent.push(item);
          olderCursor=typeof messages.nextCursor==='string'?messages.nextCursor:null;
          if(item.role==='user'||!olderCursor||olderCursor===cursor)break;
          cursor=olderCursor;
        }
        if(recent.length){
          const existing=snapshot.messages,known=new Set(existing.map(item=>item.id));
          const merged=mergeRecentMessages(existing,recent);
          const extendedOlder=!existing.length||recent.some(item=>known.has(item.id))&&
            !known.has(recent.at(-1)!.id);
          update({messages:Object.freeze(merged),messagesNextCursor:extendedOlder
            ?olderCursor:snapshot.messagesNextCursor});
        }
        const detail=await query('conversation.read',{conversationId},
          ()=>serial===openGeneration&&refreshSerial===turnRefreshGeneration&&snapshot.selected?.id===conversationId);
        const selected=detail?.conversation;
        if(current(stamp)&&serial===openGeneration&&refreshSerial===turnRefreshGeneration
          &&snapshot.selected?.id===conversationId&&summary(selected)){
          const fresh=selected as ConversationSummary;
          cache.set(conversationId,fresh);
          update({selected:fresh,conversations:Object.freeze(snapshot.conversations.map(item=>
            item.id===conversationId?fresh:item))});
        }
      }
      return row;
    },
    setDraft(conversationId,text){
      if(!id(conversationId)||!text.isWellFormed()||text.length>16000||
        snapshot.selected?.id!==conversationId||snapshot.draft?.conversationId!==conversationId)return;
      localDrafts.set(conversationId,text);
      try{storage?.setItem(storageKey(`draft:${conversationId}`),text);}catch{}
      update({draft:{...snapshot.draft,text}});
    },
    async saveDraft(conversationId,text){
      const value=text??localDrafts.get(conversationId)??snapshot.draft?.text??'';
      if(!id(conversationId)||!value.isWellFormed()||value.length>16000)return {kind:'rejected',code:'invalid_input'};
      if(snapshot.selected?.id!==conversationId||snapshot.draft?.conversationId!==conversationId)
        return {kind:'rejected',code:'stale'};
      const result=await invoke('draft.save',{conversationId,text:value,revision:snapshot.draft.revision},true);
      if(result.kind!=='ok')return result;
      const draft=result.value as unknown as ConversationDraft;
      const newer=localDrafts.get(conversationId);
      if(newer===undefined||newer===value){
        localDrafts.delete(conversationId);try{storage?.removeItem(storageKey(`draft:${conversationId}`));}catch{}
      }
      if(snapshot.selected?.id===conversationId)update({draft:newer!==undefined&&newer!==value
        ?{...draft,text:newer}:draft});
      return {kind:'ok',value:draft};
    },
    async readTurn(conversationId,turnId){const result=await query('turn.read',{conversationId,turnId});
      return object(result?.turn) as unknown as ConversationTurn|null;},
    async readEvents(conversationId,turnId,afterSequence=0){const result=await query('event.list',{conversationId,turnId,
      limit:50,afterSequence});return Array.isArray(result?.items)?{items:result.items as ConversationEvent[],
      nextSequence:typeof result.nextSequence==='number'?result.nextSequence:null}:null;},
    async cancelTurn(conversationId,turnId,revision){const result=await invoke('turn.cancel',{conversationId,turnId,revision},true);
      if(result.kind!=='ok')return result;
      const stopped=result.value.turn as ConversationTurn|null;
      if(stopped&&snapshot.selected?.id===conversationId&&snapshot.activeTurn?.id===turnId)
        update({activeTurn:stopped});
      return {kind:'ok',value:stopped};},
    async linkAttachment(conversationId,staged){
      const result=await invoke('attachment.link',{conversationId,staged,
        revision:cache.get(conversationId)?.revision??0},true);
      if(result.kind!=='ok')return result;
      if(!id(result.value.fileId)||result.value.conversationId!==conversationId)
        return {kind:'unknown',code:'invalid_output',requestKey:''};
      advanceRevision(conversationId);
      return {kind:'ok',value:{fileId:result.value.fileId,conversationId}};
    },
    async listAttachments(conversationId,cursor,limit=25){
      if(!id(conversationId))return null;
      const result=await query('attachment.list',{conversationId,limit,...(cursor?{cursor}:{})});
      return Array.isArray(result?.items)?{items:result.items as ConversationAttachment[],
        nextCursor:typeof result.nextCursor==='string'?result.nextCursor:null}:null;
    },
    async reconcileUnknown():Promise<OperationClientResult|null>{
      const pending=snapshot.unknown;if(!pending)return null;
      if(!active||snapshot.phase!=='ready')return null;
      const result=await options.client.status({bindingId:pending.bindingId,contextId:options.contextId,
        requestKey:pending.requestKey,isCurrent:()=>active&&snapshot.phase==='ready'&&scope()===identity});
      if(result.kind==='rejected'&&['forbidden','unauthorized'].includes(result.code)){
        purgeAuthorized(result.code);return result;
      }
      const name=pending.bindingId.slice(`creezio.conversations:${options.audience}.`.length);
      const confirmed=result.kind==='execution'&&(result.execution.state==='succeeded'
        ||name==='turn.start'&&result.execution.state==='waiting');
      if(result.kind==='execution'&&(confirmed||result.execution.state==='failed')){
        if(confirmed){
          const output=object(result.execution.output);
          if(!output||!validOutput(name,output)){update({error:'invalid_output'});return result;}
        }
        update({unknown:null,error:result.execution.state==='failed'?result.execution.errorCode:null});
        try{storage?.removeItem(storageKey('unknown'));}catch{}
        if(confirmed){
          const selectedId=snapshot.selected?.id;
          if(name==='turn.start'){
            const confirmed=object(object(result.execution.output)?.turn);
            if(selectedId&&id(confirmed?.id)&&confirmed?.conversationId===selectedId){
              turnIds.set(selectedId,confirmed.id);
              try{storage?.setItem(storageKey(`turn:${selectedId}`),confirmed.id);}catch{}
            }
          }
          await controller.refresh();
          if(selectedId&&snapshot.selected?.id===selectedId)await controller.open(selectedId);
        }
      }
      return result;
    },
    dispose(){if(disposed)return;disposed=true;generation++;
      for(const request of driveRequests)request.abort();driveRequests.clear();
      unsubscribe();listeners.clear();}
  };
  resumeIncompleteSelection();
  return Object.freeze(controller);
}
