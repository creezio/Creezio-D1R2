import type {OperationClient,OperationClientResult} from './client.ts';

export type CommandScope=Readonly<{sessionId:string;audience:'admin'|'app';contextId:string}>;
export type PendingCommand=CommandScope&Readonly<{
  bindingId:string;requestKey:string;intent?:string;targetId?:string;
}>;
export type CommandOutcome=Readonly<{result:OperationClientResult;pending:PendingCommand|null}>;
type CommandClient=Pick<OperationClient,'audience'|'invoke'|'status'>;
type Persist=(pending:PendingCommand|null)=>boolean;

const id=(value:unknown):value is string=>typeof value==='string'&&value.length<=128
  &&/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
const binding=(value:unknown):value is string=>typeof value==='string'&&value.length<=257
  &&/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}:[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value);
const requestKey=(value:unknown):value is string=>typeof value==='string'&&value.length>0
  &&value.isWellFormed()&&new TextEncoder().encode(value).length<=512;
const intent=(value:unknown):value is string=>typeof value==='string'&&value.length<=64
  &&/^[a-z][a-z0-9._-]*$/.test(value);
const plain=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'
  &&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
const reject=(code:string):OperationClientResult=>({kind:'rejected',code,status:0});
const unknown=(code:string):OperationClientResult=>({kind:'unknown',code});
const outcome=(result:OperationClientResult,pending:PendingCommand|null):CommandOutcome=>({result,pending});

/** Restore only bounded identifiers for the current verified session and context. */
export function readPendingCommand(value:unknown,scope:CommandScope):PendingCommand|null{
  if(!plain(value)||!id(scope.sessionId)||!id(scope.contextId)
    ||!['admin','app'].includes(scope.audience))return null;
  const allowed=['sessionId','audience','contextId','bindingId','requestKey','intent','targetId'];
  const descriptors=Object.getOwnPropertyDescriptors(value);
  if(Reflect.ownKeys(descriptors).some(key=>typeof key!=='string'||!allowed.includes(key)
    ||!Object.hasOwn(descriptors[key],'value')))return null;
  const optionalIntent=value.intent,optionalTargetId=value.targetId;
  if(value.sessionId!==scope.sessionId||value.audience!==scope.audience||value.contextId!==scope.contextId
    ||!binding(value.bindingId)||!requestKey(value.requestKey))return null;
  let acceptedIntent:string|undefined,acceptedTargetId:string|undefined;
  if(optionalIntent!==undefined){if(!intent(optionalIntent))return null;acceptedIntent=optionalIntent;}
  if(optionalTargetId!==undefined){if(!id(optionalTargetId))return null;acceptedTargetId=optionalTargetId;}
  return Object.freeze({sessionId:scope.sessionId,audience:scope.audience,contextId:scope.contextId,
    bindingId:value.bindingId,requestKey:value.requestKey,
    ...(acceptedIntent===undefined?{}:{intent:acceptedIntent}),
    ...(acceptedTargetId===undefined?{}:{targetId:acceptedTargetId})});
}

/** One in-flight mutation per panel. The caller owns panel-state persistence. */
export function createCommandJournal(scope:CommandScope,initial:unknown=null){
  if(!id(scope.sessionId)||!id(scope.contextId)||!['admin','app'].includes(scope.audience))
    throw new TypeError('Invalid command scope.');
  const capturedScope=Object.freeze({sessionId:scope.sessionId,audience:scope.audience,contextId:scope.contextId});
  let pending=readPendingCommand(initial,capturedScope);
  const current=(check:()=>boolean)=>{
    try{return check()===true;}catch{return false;}
  };
  const save=(persist:Persist,value:PendingCommand|null)=>{
    try{return persist(value)===true;}catch{return false;}
  };
  const clear=(persist:Persist,issued:PendingCommand)=>{
    if(pending===issued&&save(persist,null))pending=null;
  };
  const terminal=(result:OperationClientResult)=>result.kind==='execution'
    &&(result.execution.state==='succeeded'||result.execution.state==='failed');
  return Object.freeze({
    get pending(){return pending;},
    async execute(client:CommandClient,command:unknown,input:Readonly<Record<string,unknown>>,
      isCurrent:()=>boolean,persist:Persist):Promise<CommandOutcome>{
      if(pending)return outcome(unknown('in_progress'),pending);
      if(!client||client.audience!==capturedScope.audience)return outcome(reject('audience_mismatch'),null);
      const issued=readPendingCommand(command,capturedScope);
      if(!issued||!input||typeof input!=='object'||Array.isArray(input)
        ||typeof isCurrent!=='function'||typeof persist!=='function')
        return outcome(reject('invalid_input'),null);
      if(!current(isCurrent))return outcome(reject('stale'),null);
      pending=issued;
      if(!save(persist,issued)){
        pending=null;save(persist,null);
        return outcome(reject('client_state_unavailable'),null);
      }
      if(!current(isCurrent)){
        clear(persist,issued);
        return outcome(reject('stale'),pending);
      }
      let result:OperationClientResult;
      try{result=await client.invoke({bindingId:issued.bindingId,contextId:issued.contextId,
        input:{...input,requestKey:issued.requestKey},isCurrent});}
      catch{result=unknown('outcome_unknown');}
      if(!current(isCurrent))result=unknown('stale');
      if(result.kind==='rejected'||terminal(result))clear(persist,issued);
      return outcome(result,pending);
    },
    async inspect(client:CommandClient,isCurrent:()=>boolean,persist:Persist):Promise<CommandOutcome|null>{
      const issued=pending;
      if(!issued)return null;
      if(!client||client.audience!==capturedScope.audience)return outcome(reject('audience_mismatch'),pending);
      if(typeof isCurrent!=='function'||typeof persist!=='function')return outcome(reject('invalid_input'),pending);
      if(!current(isCurrent))return outcome(reject('stale'),pending);
      let result:OperationClientResult;
      try{result=await client.status({bindingId:issued.bindingId,contextId:issued.contextId,
        requestKey:issued.requestKey,isCurrent});}
      catch{result=unknown('unavailable');}
      if(!current(isCurrent))result=unknown('stale');
      if(terminal(result))clear(persist,issued);
      return outcome(result,pending);
    }
  });
}
