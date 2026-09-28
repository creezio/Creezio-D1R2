import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {mkdir,lstat,open,readFile,realpath,rename,statfs} from 'node:fs/promises';
import path from 'node:path';
import {createInterface} from 'node:readline';
import {loadLocalConfiguration} from '../../local/config.mjs';
import {acquireLocalRuntimeLock} from '../../local/lock.mjs';
import {openLocalStorage} from '../../local/database.mjs';
import {inspectCompositionSchema} from '../../data/apply-schema.mjs';
import {schemaDigest} from '../../data/composition-schema.mjs';
import type {VaultKeyring} from '../../../core/vault/crypto.ts';
import type {CapturedObject,CapturedRow,CapturedTable,SecretSelection,SqlCell,TransferCapture,
  TransferDigest,TransferIdentity,TransferManifest,TransferTarget} from './types.ts';

const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const HASH=/^sha256-[a-f0-9]{64}$/;
const SHA=/^[a-f0-9]{40}$/;
const GIB=1024**3;
const MIN_FREE_BYTES=20*GIB;
const OBJECT_INDEX_SEGMENT_BYTES=8*1024*1024;
const ACCESS_SKIP=new Set(['sessions','bootstrap','auth_throttles','account_capabilities',
  'api_credentials','api_credential_scopes','impersonations','impersonation_permissions',
  'oauth_clients','oauth_requests','oauth_grants','oauth_codes','oauth_access_tokens','oauth_refresh_tokens']);
const ROOT_FILE=/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const encoder=new TextEncoder();
type ModelPart=Readonly<{modelId:string;table:string;model:{
  fields:readonly {id:string;type:string;nullable:boolean}[];primaryKey:readonly string[];
  relations:readonly {fields:readonly string[];target:{moduleId:string;id:string}}[]}}>;
type ModelEntry=ModelPart&Readonly<{moduleId:string}>;
type Plan=Readonly<{applicationId:string;compositionDigest:string;lockDigest:string;modelDigest:string;
  planDigest:string;objects:readonly unknown[];host:{moduleId:string;models:readonly ModelPart[]};
  runtimeCatalog:{modules:readonly {moduleId:string;models:readonly ModelPart[]}[]}}>;
export class TransferCaptureError extends Error {
  readonly code:'invalid_input'|'unsafe_path'|'source_busy'|'source_unavailable'|'schema_mismatch'
    |'active_effect'|'unsupported_value'|'capture_incomplete'|'disk_low'|'integrity_error';
  constructor(code:TransferCaptureError['code']){super(`Local transfer refused (${code}).`);
    this.name='TransferCaptureError';this.code=code;}
}
const fail=(code:TransferCaptureError['code']):never=>{throw new TransferCaptureError(code);};
const digest=(value:string|Uint8Array):TransferDigest=>`sha256-${createHash('sha256').update(value).digest('hex')}`;
const quote=(name:string)=>`"${name.replaceAll('"','""')}"`;
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
function plain(value:unknown):value is Record<string,unknown>{return !!value&&typeof value==='object'
  &&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));}
function validTarget(value:unknown):value is TransferTarget {
  if(!plain(value)||Object.keys(value).sort().join(',')!=='accountId,bucketName,databaseId,origin,workerName'
    ||!['accountId','bucketName','databaseId','workerName'].every(key=>typeof value[key]==='string'
      &&(value[key] as string).length>0&&(value[key] as string).length<=128
      &&/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value[key] as string)))return false;
  try{const url=new URL(value.origin as string);return url.protocol==='https:'&&url.origin===value.origin;}
  catch{return false;}
}
function cell(value:unknown):SqlCell {
  if(value===null)return null;
  if(typeof value==='string'&&value.isWellFormed())return {type:'text',value};
  if(typeof value==='number'&&Number.isFinite(value)){
    if(Number.isInteger(value)){if(!Number.isSafeInteger(value))return fail('unsupported_value');
      return {type:'integer',value};}
    return {type:'real',value};
  }
  if(value instanceof ArrayBuffer||value instanceof Uint8Array){
    const bytes=value instanceof Uint8Array?value:new Uint8Array(value);
    return {type:'blob',base64url:Buffer.from(bytes).toString('base64url')};
  }
  return fail('unsupported_value');
}
function modelEntries(plan:Plan):ModelEntry[]{
  const result:ModelEntry[]=[];
  for(const group of [plan.host,...plan.runtimeCatalog.modules])for(const entry of group.models){
    if(typeof entry.table!=='string'||!/^cz_[a-f0-9]+_[a-f0-9]+$/.test(entry.table)
      ||typeof entry.modelId!=='string'||!Array.isArray(entry.model?.fields)
      ||!Array.isArray(entry.model?.primaryKey)||!Array.isArray(entry.model?.relations))return fail('invalid_input');
    result.push({...entry,moduleId:group.moduleId});
  }
  const key=(item:ModelEntry)=>`${item.moduleId}\0${item.modelId}`;
  const byKey=new Map(result.map(item=>[key(item),item]));
  if(new Set(result.map(item=>item.table)).size!==result.length||byKey.size!==result.length)
    return fail('invalid_input');
  const ordered:ModelEntry[]=[],marks=new Map<string,'visiting'|'done'>();
  function visit(entry:ModelEntry){
    const mark=marks.get(key(entry));
    if(mark==='visiting')return fail('invalid_input');
    if(mark==='done')return;
    marks.set(key(entry),'visiting');
    for(const relation of entry.model.relations){
      if(!relation||!Array.isArray(relation.fields)||typeof relation.target?.moduleId!=='string'
        ||typeof relation.target.id!=='string')return fail('invalid_input');
      const parent=byKey.get(`${relation.target.moduleId}\0${relation.target.id}`);
      if(!parent||parent.moduleId!==entry.moduleId)return fail('invalid_input');
      if(policy(parent)==='skip'){
        // Session rows are intentionally not transferred. Only this optional audit
        // reference is cleared in the captured row; every other such edge is refused.
        if(entry.moduleId!=='creezio.access'||entry.modelId!=='access_audit'
          ||parent.modelId!=='sessions'||relation.fields.length!==1
          ||relation.fields[0]!=='session_id'
          ||entry.model.fields.find(field=>field.id==='session_id')?.nullable!==true)
          return fail('invalid_input');
      }else visit(parent);
    }
    marks.set(key(entry),'done');ordered.push(entry);
  }
  const sorted=result.sort((a,b)=>a.table.localeCompare(b.table));
  for(const entry of sorted)if(policy(entry)!=='skip')visit(entry);
  return [...ordered,...sorted.filter(entry=>policy(entry)==='skip')];
}
function policy(entry:ModelEntry):CapturedTable['policy'] {
  if(entry.moduleId==='creezio.access'&&ACCESS_SKIP.has(entry.modelId))return 'skip';
  if(entry.moduleId==='creezio.access'&&entry.modelId==='access_audit')return 'transform';
  if(entry.moduleId==='creezio.openai'&&['provider_config','provider_secret'].includes(entry.modelId))return 'transform';
  return 'copy';
}
type SourceDb=Awaited<ReturnType<typeof openLocalStorage>>['db'];
type QuietHistory=Readonly<{rows:ReadonlyMap<string,string>;count:number}>;
function rowKey(entry:ModelEntry,row:Record<string,unknown>){
  return `${entry.table}\0${JSON.stringify(entry.model.primaryKey.map(key=>row[key]))}`;
}
async function selectedRows(db:SourceDb,entry:ModelEntry|undefined,where:string):Promise<Record<string,unknown>[]> {
  if(!entry)return [];
  const columns=entry.model.fields.map(field=>field.id);
  const query=`SELECT ${columns.map(quote).join(',')} FROM ${quote(entry.table)} WHERE ${where}
    ORDER BY ${entry.model.primaryKey.map(quote).join(',')} LIMIT 1 OFFSET ?`;
  const rows:Record<string,unknown>[]=[];
  for(let offset=0;;offset++){
    const result=await db.prepare(query).bind(offset).all();
    if(result.success!==true||!Array.isArray(result.results))return fail('source_unavailable');
    const row=result.results[0] as Record<string,unknown>|undefined;
    if(!row)break;
    rows.push(row);
  }
  return rows;
}
function parsedRecord(value:unknown):Record<string,unknown>|null{
  if(typeof value!=='string')return null;
  try{const parsed:unknown=JSON.parse(value);return plain(parsed)?parsed:null;}
  catch{return null;}
}
async function preflightEffects(db:SourceDb,entries:readonly ModelEntry[]):Promise<QuietHistory>{
  // Only the old, receipt-free OpenAI turn has a safe historical projection:
  // the copied key still returns its execution, and turn.drive cannot create a
  // second provider request from an unknown outbox without a receipt.
  const entry=(moduleId:string,modelId:string)=>entries.find(item=>item.moduleId===moduleId&&item.modelId===modelId);
  const runtime=(modelId:string)=>entry('creezio.runtime',modelId);
  const conversations=(modelId:string)=>entry('creezio.conversations',modelId);
  const [executions,outbox,turns,parents,attempts,approvals,files]=await Promise.all([
    selectedRows(db,runtime('executions'),"state NOT IN ('succeeded','failed')"),
    selectedRows(db,runtime('outbox'),"state NOT IN ('succeeded','failed')"),
    selectedRows(db,conversations('turn'),"state NOT IN ('succeeded','failed','cancelled')"),
    selectedRows(db,conversations('conversation'),'active_turn_id IS NOT NULL'),
    selectedRows(db,runtime('attempts'),"state NOT IN ('succeeded','failed')"),
    selectedRows(db,runtime('approvals'),"state NOT IN ('consumed','rejected')"),
    selectedRows(db,conversations('file_metadata'),"state IN ('staging','staged')"),
  ]);
  if(approvals.length||files.length)return fail('active_effect');
  if(!executions.length&&!outbox.length&&!turns.length&&!parents.length&&!attempts.length)
    return {rows:new Map(),count:0};
  if(!executions.length||executions.length!==outbox.length||outbox.length!==turns.length
    ||turns.length!==parents.length)return fail('active_effect');
  const executionEntry=runtime('executions'),outboxEntry=runtime('outbox'),turnEntry=conversations('turn'),
    parentEntry=conversations('conversation'),messageEntry=conversations('message'),
    eventEntry=conversations('event'),attemptEntry=runtime('attempts'),auditEntry=runtime('audit');
  if(!executionEntry||!outboxEntry||!turnEntry||!parentEntry||!messageEntry||!eventEntry
    ||!attemptEntry||!auditEntry)return fail('active_effect');
  const byExecution=new Map(executions.map(row=>[row.id,row]));
  const byOutbox=new Map(outbox.map(row=>[row.execution_id,row]));
  const turnKey=(row:Record<string,unknown>)=>
    JSON.stringify([row.context_id,row.owner_id,row.audience,row.conversation_id,row.id]);
  const parentKey=(row:Record<string,unknown>)=>
    JSON.stringify([row.context_id,row.owner_id,row.audience,row.id]);
  const byTurn=new Map(turns.map(row=>[turnKey(row),row]));
  const byParent=new Map(parents.map(row=>[parentKey(row),row]));
  if(byExecution.size!==executions.length||byOutbox.size!==outbox.length
    ||byTurn.size!==turns.length||byParent.size!==parents.length)return fail('active_effect');
  const now=Date.now();
  for(const execution of executions){
    const delivery=byOutbox.get(execution.id),payload=parsedRecord(delivery?.payload),
      output=parsedRecord(execution.output);
    if(execution.state!=='unknown'||execution.module_id!=='creezio.conversations'
      ||execution.operation_id!=='turn.start'||typeof execution.actor_principal_id!=='string'
      ||!ID.test(execution.actor_principal_id)||!Number.isSafeInteger(execution.claim_expires_at_ms)
      ||Number(execution.claim_expires_at_ms)>now||!delivery||delivery.state!=='unknown'
      ||delivery.provider!=='openai.responses.v1'||delivery.receipt!==null
      ||!Number.isSafeInteger(delivery.claim_expires_at_ms)
      ||Number(delivery.claim_expires_at_ms)>now||delivery.provider_idempotency_key!==delivery.intent_id
      ||typeof delivery.claim_nonce!=='string'||!ID.test(delivery.claim_nonce)
      ||!payload||payload.turnId!==delivery.intent_id||payload.step!==0
      ||Object.keys(payload).sort().join(',')!=='conversationId,messageId,modelId,step,turnId'
      ||typeof payload.conversationId!=='string'||!ID.test(payload.conversationId)
      ||typeof payload.messageId!=='string'||!ID.test(payload.messageId)
      ||typeof payload.modelId!=='string'||!ID.test(payload.modelId)
      ||!output||!plain(output.turn)||output.turn.id!==delivery.intent_id
      ||output.turn.conversationId!==payload.conversationId
      ||!plain(output.message)||output.message.id!==payload.messageId
      ||output.message.conversationId!==payload.conversationId)return fail('active_effect');
    const turn=byTurn.get(JSON.stringify([execution.context_id,execution.principal_id,
      execution.audience,payload.conversationId,delivery.intent_id]));
    const parent=byParent.get(JSON.stringify([execution.context_id,execution.principal_id,
      execution.audience,payload.conversationId]));
    if(!turn||turn.state!=='unknown'||turn.provider_id!=='openai.responses.v1'
      ||!parent||parent.active_turn_id!==turn.id||parent.archived_at!==null)
      return fail('active_effect');
    const messages=await db.prepare(`SELECT context_id,owner_id,audience,conversation_id,id,role,body
      FROM ${quote(messageEntry.table)} WHERE context_id=? AND owner_id=? AND audience=?
      AND conversation_id=? AND id=? LIMIT 2`).bind(execution.context_id,execution.principal_id,
      execution.audience,payload.conversationId,payload.messageId).all();
    const message=messages.results?.[0] as Record<string,unknown>|undefined;
    const events=await db.prepare(`SELECT context_id,owner_id,audience,conversation_id,turn_id,sequence,kind
      FROM ${quote(eventEntry.table)} WHERE context_id=? AND owner_id=? AND audience=?
      AND conversation_id=? AND turn_id=? ORDER BY sequence`).bind(execution.context_id,
      execution.principal_id,execution.audience,payload.conversationId,turn.id).all();
    if(messages.success!==true||!Array.isArray(messages.results)||messages.results.length!==1
      ||!message||message.context_id!==execution.context_id
      ||message.owner_id!==execution.principal_id||message.audience!==execution.audience
      ||message.conversation_id!==payload.conversationId||message.role!=='user'
      ||output.message.role!=='user'||output.message.body!==message.body
      ||events.success!==true||!Array.isArray(events.results)||events.results.length<2
      ||events.results.some(row=>row.context_id!==execution.context_id
        ||row.owner_id!==execution.principal_id||row.audience!==execution.audience
        ||row.conversation_id!==payload.conversationId||row.turn_id!==turn.id
        ||!['queued','cancel_requested','unknown'].includes(String(row.kind)))
      ||events.results[0]?.kind!=='queued'||events.results[0]?.sequence!==1
      ||events.results.at(-1)?.kind!=='unknown'
      ||events.results.at(-1)?.sequence!==turn.last_sequence)return fail('active_effect');
    const deliveries=await db.prepare(`SELECT id FROM ${quote(outboxEntry.table)} WHERE execution_id=? LIMIT 2`)
      .bind(execution.id).all();
    const priorAttempts=await db.prepare(`SELECT state,claim_nonce,number,settled_at_ms
      FROM ${quote(attemptEntry.table)} WHERE execution_id=?`)
      .bind(execution.id).all();
    const audit=await db.prepare(`SELECT event,attempt_nonce,outbox_id,actor_principal_id,principal_id,context_id,audience
      FROM ${quote(auditEntry.table)} WHERE execution_id=?`).bind(execution.id).all();
    if(deliveries.success!==true||!Array.isArray(deliveries.results)||deliveries.results.length!==1
      ||deliveries.results[0]?.id!==delivery.id||priorAttempts.success!==true
      ||!Array.isArray(priorAttempts.results)||!priorAttempts.results.some(row=>
        row.state==='succeeded'&&row.claim_nonce===execution.claim_nonce
        &&row.number===execution.attempt_number)
      ||audit.success!==true||!Array.isArray(audit.results)
      ||!audit.results.some(row=>row.event==='started')
      ||(execution.attempt_number===1
        ?!audit.results.some(row=>row.event==='started'&&row.attempt_nonce===execution.claim_nonce)
        :!Number.isSafeInteger(execution.attempt_number)||Number(execution.attempt_number)<2
          ||!audit.results.some(row=>row.event==='resumed'&&row.attempt_nonce===execution.claim_nonce))
      ||!audit.results.some(row=>row.event==='committed'&&row.attempt_nonce===execution.claim_nonce)
      ||!audit.results.some(row=>row.event==='delivery-claimed'&&row.outbox_id===delivery.intent_id
        &&row.attempt_nonce===delivery.claim_nonce)
      ||!audit.results.some(row=>row.event==='delivery-unknown'&&row.outbox_id===delivery.intent_id
        &&row.attempt_nonce===delivery.claim_nonce)
      ||audit.results.some(row=>row.actor_principal_id!==execution.actor_principal_id
        ||row.principal_id!==execution.principal_id||row.context_id!==execution.context_id
        ||row.audience!==execution.audience))return fail('active_effect');
  }
  for(const attempt of attempts){
    const execution=byExecution.get(attempt.execution_id);
    if(!execution||attempt.state!=='unknown'||!Number.isSafeInteger(attempt.number)
      ||Number(attempt.number)<1||Number(attempt.number)>=Number(execution.attempt_number)
      ||!Number.isSafeInteger(attempt.settled_at_ms)
      ||typeof attempt.claim_nonce!=='string'||!ID.test(attempt.claim_nonce)
      ||attempt.claim_nonce===execution.claim_nonce)return fail('active_effect');
    const origin=await db.prepare(`SELECT event FROM ${quote(auditEntry.table)} WHERE execution_id=?
      AND attempt_nonce=? AND event=? LIMIT 1`).bind(execution.id,attempt.claim_nonce,
      attempt.number===1?'started':'resumed').all();
    if(origin.success!==true||!Array.isArray(origin.results)||origin.results.length!==1)
      return fail('active_effect');
  }
  const allowed=new Map<string,string>();
  for(const [selected,model] of [[executions,executionEntry],[outbox,outboxEntry],
    [turns,turnEntry],[parents,parentEntry],[attempts,attemptEntry]] as const)
    for(const row of selected)allowed.set(rowKey(model,row),JSON.stringify(row));
  return {rows:allowed,count:executions.length};
}
function checkedState(entry:ModelEntry,row:Record<string,unknown>,quiet:QuietHistory){
  const value=(field:string)=>row[field];
  const retained=quiet.rows.get(rowKey(entry,row))===JSON.stringify(row);
  if(entry.moduleId==='creezio.runtime'){
    if(entry.modelId==='executions'&&!['succeeded','failed'].includes(String(value('state')))&&!retained
      ||entry.modelId==='attempts'&&!['succeeded','failed'].includes(String(value('state')))&&!retained
      ||entry.modelId==='outbox'&&!['succeeded','failed'].includes(String(value('state')))&&!retained
      ||entry.modelId==='approvals'&&!['consumed','rejected'].includes(String(value('state'))))return fail('active_effect');
  }
  if(entry.moduleId==='creezio.conversations'){
    if(entry.modelId==='turn'&&!['succeeded','failed','cancelled'].includes(String(value('state')))&&!retained
      ||entry.modelId==='conversation'&&value('active_turn_id')!==null&&!retained
      ||entry.modelId==='file_metadata'&&['staging','staged'].includes(String(value('state'))))return fail('active_effect');
  }
}
function selections(input:readonly SecretSelection[]){
  if(!Array.isArray(input)||input.length>1000)return fail('invalid_input');
  const map=new Map<string,SecretSelection>();
  for(const item of input){if(!plain(item))return fail('invalid_input');
    const selected=item as unknown as SecretSelection;
    if(!ID.test(selected.contextId)||typeof selected.reference!=='string'
    ||!/^creezio-secret:v1:[a-f0-9-]{36}$/.test(selected.reference)||!ID.test(selected.bindingId)
    ||!['rewrap','disable'].includes(selected.mode))return fail('invalid_input');
    const key=`${item.contextId}\0${item.reference}`;
    if(map.has(key))return fail('invalid_input');map.set(key,selected);
  }
  return map;
}
async function safeDirectory(config:ReturnType<typeof loadLocalConfiguration>,directory:string,create:boolean){
  const base=path.join(config.root,'.wrangler','transfers');
  if(typeof directory!=='string'||!path.isAbsolute(directory)||path.dirname(directory)!==base
    ||!ID.test(path.basename(directory)))return fail('unsafe_path');
  for(const parent of [config.root,path.join(config.root,'.wrangler')]){
    const stat=await lstat(parent),resolved=await realpath(parent);
    if(!stat.isDirectory()||stat.isSymbolicLink()||
      (process.platform==='win32'?resolved.toLowerCase()!==parent.toLowerCase():resolved!==parent))return fail('unsafe_path');
  }
  if(create){try{await mkdir(base,{mode:0o700});}catch(error){
    if((error as NodeJS.ErrnoException).code!=='EEXIST')return fail('unsafe_path');}}
  const baseStat=await lstat(base);
  if(!baseStat.isDirectory()||baseStat.isSymbolicLink())return fail('unsafe_path');
  if(create){try{await mkdir(directory,{mode:0o700});return true;}
    catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')return fail('unsafe_path');}}
  const stat=await lstat(directory);
  if(!stat.isDirectory()||stat.isSymbolicLink())return fail('unsafe_path');
  return false;
}
function file(directory:string,name:string){
  if(!ROOT_FILE.test(name)||path.basename(name)!==name)return fail('unsafe_path');
  return path.join(directory,name);
}
async function readSafe(directory:string,name:string){
  const target=file(directory,name),stat=await lstat(target);
  if(!stat.isFile()||stat.isSymbolicLink())return fail('unsafe_path');
  return target;
}
async function freeSpace(root:string){
  const info=await statfs(root);
  if(info.bavail*info.bsize<MIN_FREE_BYTES)return fail('disk_low');
}
function metadata(value:unknown){
  if(value===undefined||value===null)return {};
  if(!plain(value))return fail('unsupported_value');
  const result:Record<string,string>={};
  for(const [key,item] of Object.entries(value).sort(([a],[b])=>a.localeCompare(b))){
    if(!/^[A-Za-z][A-Za-z0-9-]{0,63}$/.test(key))return fail('unsupported_value');
    const text=item instanceof Date?item.toISOString():item;
    if(typeof text!=='string'||!text.isWellFormed())return fail('unsupported_value');
    result[key]=text;
  }
  if(encoder.encode(JSON.stringify(result)).length>16_384)return fail('unsupported_value');
  return result;
}
function isManifest(value:unknown):value is TransferManifest {
  return plain(value)&&value.schemaVersion===1&&plain(value.identity)
    &&HASH.test(String(value.manifestDigest))&&Array.isArray(value.tables)
    &&(value.uncertainHistoryCount===undefined||Number.isSafeInteger(value.uncertainHistoryCount)
      &&Number(value.uncertainHistoryCount)>=0)
    &&value.tables.length<=1024&&plain(value.objects)&&Array.isArray(value.objects.segments)
    &&value.objects.segments.length<=256;
}

/** Capture is materialized while the official local runtime is stopped and the export lock is held. */
export async function captureLocalTransfer(input:{config:ReturnType<typeof loadLocalConfiguration>;
  plan:Plan;transferId:string;sourceSha:string;target:TransferTarget;directory:string;
  secretSelections:readonly SecretSelection[];sourceKeyring?:VaultKeyring;targetKeyring?:VaultKeyring}):Promise<TransferCapture>{
  if(!input||!ID.test(input.transferId)||!SHA.test(input.sourceSha)||!validTarget(input.target)
    ||!input.plan||!HASH.test(input.plan.planDigest)||!HASH.test(input.plan.modelDigest)
    ||!HASH.test(input.plan.compositionDigest)||!HASH.test(input.plan.lockDigest)
    ||typeof input.directory!=='string'||path.basename(input.directory)!==input.transferId)return fail('invalid_input');
  const config=loadLocalConfiguration({root:input.config.root,origin:input.config.origin}),
    chosen=selections(input.secretSelections),entries=modelEntries(input.plan);
  if([...chosen.values()].some(item=>item.mode==='rewrap')&&(!input.sourceKeyring||!input.targetKeyring))
    return fail('invalid_input');
  await freeSpace(config.root);
  let lock:Awaited<ReturnType<typeof acquireLocalRuntimeLock>>|undefined,
    storage:Awaited<ReturnType<typeof openLocalStorage>>|undefined;
  try{
    try{lock=await acquireLocalRuntimeLock(config,'export');}
    catch(error){if((error as {code?:string}).code==='local_busy')return fail('source_busy');throw error;}
    let existingDirectory=false;
    try{await lstat(input.directory);existingDirectory=true;}
    catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')return fail('unsafe_path');}
    if(existingDirectory){
      let existing:TransferManifest;
      try{existing=await loadCapturedTransfer({config,directory:input.directory,transferId:input.transferId});}
      catch{return fail('capture_incomplete');}
      if(!existing||existing.identity.sourceSha!==input.sourceSha||!same(existing.identity.target,input.target)
        ||existing.identity.planDigest!==input.plan.planDigest)return fail('capture_incomplete');
      return Object.freeze({manifest:existing,directory:input.directory,async release(){}});
    }
    storage=await openLocalStorage(config);
    const inspected=await inspectCompositionSchema(storage.db,input.plan);
    if(inspected.state!=='ready'||!HASH.test(String(inspected.receiptId)))return fail('schema_mismatch');
    const quiet=await preflightEffects(storage.db,entries);
    // A predictable active effect cannot leave a partial capture directory.
    if(!await safeDirectory(config,input.directory,true))return fail('capture_incomplete');
    const identity:TransferIdentity={transferId:input.transferId,applicationId:input.plan.applicationId,
      sourceSha:input.sourceSha,compositionDigest:input.plan.compositionDigest as TransferDigest,
      lockDigest:input.plan.lockDigest as TransferDigest,modelDigest:input.plan.modelDigest as TransferDigest,
      schemaObjectsDigest:schemaDigest(input.plan.objects) as TransferDigest,
      planDigest:input.plan.planDigest as TransferDigest,sourceSchemaReceiptId:inspected.receiptId as TransferDigest,
      target:input.target};
    const policyDigest=schemaDigest(entries.map(entry=>({moduleId:entry.moduleId,modelId:entry.modelId,
      table:entry.table,policy:policy(entry)}))) as TransferDigest;
    const tables:CapturedTable[]=[];
    const seenSecrets=new Set<string>();
    for(const entry of entries){
      const columns=entry.model.fields.map(field=>field.id),primaryKey=[...entry.model.primaryKey];
      if(!columns.length||new Set(columns).size!==columns.length||!primaryKey.length
        ||primaryKey.some(key=>!columns.includes(key)))return fail('invalid_input');
      const action=policy(entry),dataFile=action==='skip'?null:`table-${createHash('sha256').update(entry.table).digest('hex')}.ndjson`;
      const statement=`SELECT ${columns.map(quote).join(',')} FROM ${quote(entry.table)} ORDER BY ${primaryKey.map(quote).join(',')} LIMIT 1 OFFSET ?`;
      const hash=createHash('sha256');let rowCount=0,sourceRowCount=0,byteLength=0;
      const handle=dataFile?await open(file(input.directory,dataFile),'wx',0o600):null;
      try{
        for(let offset=0;;offset++){
          const result=await storage.db.prepare(statement).bind(offset).all();
          if(result.success!==true||!Array.isArray(result.results))return fail('source_unavailable');
          const row=result.results[0] as Record<string,unknown>|undefined;
          if(!row)break;
          checkedState(entry,row,quiet);sourceRowCount++;
          if(action==='skip')continue;
          if(entry.moduleId==='creezio.access'&&entry.modelId==='access_audit')
            row.session_id=null;
          if(entry.moduleId==='creezio.openai'&&entry.modelId==='provider_config'){
            const contextId=String(row.context_id),ref=row.api_key_ref;
            const selection=typeof ref==='string'?chosen.get(`${contextId}\0${ref}`):undefined;
            if(!selection||selection.mode==='disable'){
              row.api_key_ref=null;row.secret_version=null;row.enabled=0;
              if(!Number.isSafeInteger(row.revision)||Number(row.revision)>=Number.MAX_SAFE_INTEGER)return fail('unsupported_value');
              row.revision=Number(row.revision)+1;row.updated_at=new Date().toISOString();
            }
          }
          if(entry.moduleId==='creezio.openai'&&entry.modelId==='provider_secret'){
            const contextId=String(row.context_id),reference=String(row.id),key=`${contextId}\0${reference}`;
            const selection=chosen.get(key);
            if(!selection||selection.mode==='disable')continue;
            if(selection.bindingId!==row.binding_id||!Number.isSafeInteger(row.version)
              ||row.state!=='active')return fail('invalid_input');
            const vaultContext={moduleId:'creezio.openai',contextId,reference,
              bindingId:selection.bindingId,version:Number(row.version)};
            const clear=await input.sourceKeyring!.open(vaultContext,String(row.ciphertext));
            row.ciphertext=await input.targetKeyring!.seal(vaultContext,clear);
            row.key_id=input.targetKeyring!.activeKeyId;seenSecrets.add(key);
          }
          rowCount++;
          const values=columns.map(column=>cell(row[column]));
          const line=JSON.stringify({values} satisfies CapturedRow)+'\n',size=encoder.encode(line).length;
          if(size>131_072)return fail('unsupported_value');
          await handle!.writeFile(line);hash.update(line);byteLength+=size;
        }
      }finally{await handle?.close();}
      tables.push({moduleId:entry.moduleId,modelId:entry.modelId,table:entry.table,columns,primaryKey,
        policy:action,sourceRowCount,rowCount,byteLength,
        rowDigest:`sha256-${hash.digest('hex')}` as TransferDigest,dataFile});
    }
    for(const [key,item] of chosen)if(item.mode==='rewrap'&&!seenSecrets.has(key))return fail('invalid_input');
    const objectSegments:TransferManifest['objects']['segments'][number][]=[],seenKeys=new Set<string>();
    let count=0,bytes=0,cursor:string|undefined,segmentHandle:Awaited<ReturnType<typeof open>>|undefined,
      segmentHash=createHash('sha256'),segmentCount=0,segmentBytes=0,segmentFile='';
    const finishSegment=async()=>{
      if(!segmentHandle)return;
      await segmentHandle.sync();await segmentHandle.close();segmentHandle=undefined;
      objectSegments.push({indexFile:segmentFile,indexDigest:`sha256-${segmentHash.digest('hex')}` as TransferDigest,
        count:segmentCount,byteLength:segmentBytes});
    };
    const writeObject=async(line:string)=>{
      const size=encoder.encode(line).length;
      if(size>32_768)return fail('unsupported_value');
      if(segmentHandle&&segmentBytes+size>OBJECT_INDEX_SEGMENT_BYTES)await finishSegment();
      if(!segmentHandle){
        if(objectSegments.length>=256)return fail('unsupported_value');
        segmentFile=`objects-${String(objectSegments.length+1).padStart(6,'0')}.ndjson`;
        segmentHandle=await open(file(input.directory,segmentFile),'wx',0o600);
        segmentHash=createHash('sha256');segmentCount=0;segmentBytes=0;
      }
      await segmentHandle.writeFile(line);segmentHash.update(line);segmentCount++;segmentBytes+=size;
    };
    const bucket=storage.bucket;
    if(!bucket)return fail('source_unavailable');
    try{
      for(;;){
        const page=await bucket.list({limit:1000,...(cursor?{cursor}:{})});
        if(!page||!Array.isArray(page.objects))return fail('source_unavailable');
        for(const listed of page.objects){
          const key=listed.key;
          if(typeof key!=='string'||!key.length||key.length>1024||seenKeys.has(key))return fail('integrity_error');
          seenKeys.add(key);
          const object=await bucket.get(key);
          if(!object||!object.body||!Number.isSafeInteger(object.size)||object.size<0)return fail('integrity_error');
          const bodyFile=`object-${createHash('sha256').update(key).digest('hex')}.bin`,
            bodyHandle=await open(file(input.directory,bodyFile),'wx',0o600);
          const bodyHash=createHash('sha256');let objectBytes=0;
          try{
            const reader=object.body.getReader();
            try{for(;;){const {done,value}=await reader.read();if(done)break;
              if(!(value instanceof Uint8Array))return fail('unsupported_value');
              objectBytes+=value.byteLength;if(!Number.isSafeInteger(objectBytes)||objectBytes>object.size)
                return fail('integrity_error');
              bodyHash.update(value);await bodyHandle.writeFile(value);}}
            finally{reader.releaseLock();}
          }finally{await bodyHandle.close();}
          if(objectBytes!==object.size)return fail('integrity_error');
          const captured:CapturedObject={key,size:objectBytes,sha256:bodyHash.digest('hex'),
            httpMetadata:metadata(object.httpMetadata),customMetadata:metadata(object.customMetadata),bodyFile};
          const line=JSON.stringify(captured)+'\n';
          await writeObject(line);count++;bytes+=objectBytes;
          if(!Number.isSafeInteger(bytes)||count>1_000_000)return fail('unsupported_value');
        }
        if(!page.truncated)break;
        if(typeof page.cursor!=='string'||!page.cursor||page.cursor===cursor)return fail('integrity_error');
        cursor=page.cursor;
      }
      await finishSegment();
    }finally{await segmentHandle?.close();}
    const base={schemaVersion:1 as const,identity,capturedAt:new Date().toISOString(),policyDigest,
      uncertainHistoryCount:quiet.count,tables,
      objects:{count,byteLength:bytes,segments:objectSegments}};
    const manifest:TransferManifest={...base,manifestDigest:schemaDigest(base) as TransferDigest};
    const manifestPath=file(input.directory,'manifest.json'),temporary=file(input.directory,'manifest.tmp');
    const output=await open(temporary,'wx',0o600);
    try{await output.writeFile(JSON.stringify(manifest)+'\n');await output.sync();}
    finally{await output.close();}
    await rename(temporary,manifestPath);
    await storage.dispose();storage=undefined;await lock.release();lock=undefined;
    return Object.freeze({manifest,directory:input.directory,async release(){}});
  }catch(error){if(error instanceof TransferCaptureError)throw error;
    throw new TransferCaptureError('source_unavailable');}
  finally{
    let closed=true;
    if(storage)try{await storage.dispose();}catch{closed=false;}
    if(lock&&closed)await lock.release().catch(()=>{});
    // An uncertain Miniflare closure leaves its lock for manual inspection.
  }
}

/** Resume uses only the immutable snapshot. Every named file is checked; no live recapture occurs. */
export async function loadCapturedTransfer(input:{config:ReturnType<typeof loadLocalConfiguration>;
  directory:string;transferId:string}):Promise<TransferManifest>{
  const config=loadLocalConfiguration({root:input.config.root,origin:input.config.origin});
  await safeDirectory(config,input.directory,false);
  const raw=await readFile(await readSafe(input.directory,'manifest.json'),'utf8');
  if(encoder.encode(raw).length>1_048_576)return fail('integrity_error');
  let manifest:unknown;
  try{manifest=JSON.parse(raw);}catch{return fail('capture_incomplete');}
  if(!isManifest(manifest)||manifest.identity.transferId!==input.transferId)return fail('integrity_error');
  const {manifestDigest,...base}=manifest;
  if(schemaDigest(base)!==manifestDigest)return fail('integrity_error');
  for(const table of manifest.tables){
    if(table.dataFile===null)continue;
    const source=await readSafe(input.directory,table.dataFile),hash=createHash('sha256');
    let bytes=0,rows=0;
    for await(const chunk of createReadStream(source)){hash.update(chunk);bytes+=(chunk as Buffer).length;}
    if(bytes!==table.byteLength||`sha256-${hash.digest('hex')}`!==table.rowDigest)return fail('integrity_error');
    for await(const _ of readCapturedTable(manifest,input.directory,table.table))rows++;
    if(rows>table.rowCount||rows!==table.rowCount)return fail('integrity_error');
  }
  for(const segment of manifest.objects.segments){
    const objectsPath=await readSafe(input.directory,segment.indexFile),indexHash=createHash('sha256');let size=0;
    for await(const chunk of createReadStream(objectsPath)){indexHash.update(chunk);size+=(chunk as Buffer).length;}
    if(size!==segment.byteLength||`sha256-${indexHash.digest('hex')}`!==segment.indexDigest)
      return fail('integrity_error');
  }
  let count=0,total=0;
  for await(const item of readCapturedObjects(manifest,input.directory)){
    const body=await readSafe(input.directory,item.bodyFile),hash=createHash('sha256');let size=0;
    for await(const chunk of createReadStream(body)){hash.update(chunk);size+=(chunk as Buffer).length;}
    if(size!==item.size||hash.digest('hex')!==item.sha256)return fail('integrity_error');
    count++;total+=size;
  }
  if(count!==manifest.objects.count||total!==manifest.objects.byteLength)return fail('integrity_error');
  return manifest;
}
export async function* readCapturedTable(manifest:TransferManifest,directory:string,tableName:string):AsyncIterable<CapturedRow>{
  const table=manifest.tables.find(item=>item.table===tableName);
  if(!table||!table.dataFile)return fail('invalid_input');
  const source=await readSafe(directory,table.dataFile),lines=createInterface({input:createReadStream(source),crlfDelay:Infinity});
  for await(const line of lines){if(encoder.encode(line).length>131_072)return fail('integrity_error');
    let row:unknown;try{row=JSON.parse(line);}catch{return fail('integrity_error');}
    if(!plain(row)||!Array.isArray(row.values)||row.values.length!==table.columns.length)return fail('integrity_error');
    yield row as unknown as CapturedRow;
  }
}
export async function* readCapturedObjects(manifest:TransferManifest,directory:string):AsyncIterable<CapturedObject>{
  for(const segment of manifest.objects.segments){
    const source=await readSafe(directory,segment.indexFile),
      lines=createInterface({input:createReadStream(source),crlfDelay:Infinity});
    let count=0;
    for await(const line of lines){if(encoder.encode(line).length>32_768)return fail('integrity_error');
      let item:unknown;try{item=JSON.parse(line);}catch{return fail('integrity_error');}
      if(!plain(item)||typeof item.key!=='string'||typeof item.bodyFile!=='string'
        ||!Number.isSafeInteger(item.size)||!/^([a-f0-9]{64})$/.test(String(item.sha256)))return fail('integrity_error');
      count++;yield item as unknown as CapturedObject;
    }
    if(count!==segment.count)return fail('integrity_error');
  }
}
