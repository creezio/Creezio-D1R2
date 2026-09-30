import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {lstat} from 'node:fs/promises';
import path from 'node:path';
import {inspectCompositionSchema} from '../../data/apply-schema.mjs';
import {schemaDigest} from '../../data/composition-schema.mjs';
import {loadLocalConfiguration} from '../../local/config.mjs';
import {loadCapturedTransfer,readCapturedObjects,readCapturedTable} from './source.ts';
import type {CapturedObject,CapturedRow,CapturedTable,SqlCell,TransferCheckpoint,TransferJournal,
  TransferDigest,TransferManifest,TransferObjectPort,TransferTarget} from './types.ts';

const PAGE_ROWS=16;
const VERIFY_ROWS=100;
const HASH=/^sha256-[a-f0-9]{64}$/;
const quote=(name:string)=>`"${name.replaceAll('"','""')}"`;
type Config=ReturnType<typeof loadLocalConfiguration>;
type TargetPlan=Readonly<{applicationId:string;modelDigest:string;objects:readonly unknown[];
  planDigest:string}>;
type Args=Readonly<{config:Config;directory:string;manifest:TransferManifest;targetPlan:TargetPlan;
  db:D1Database;objects:TransferObjectPort;expectedTarget?:TransferTarget;
  expectedContextId?:string}>;
export class TransferDestinationError extends Error {
  readonly code:'invalid_input'|'schema_mismatch'|'conflict'|'outcome_unknown'|'integrity_error'|'unavailable';
  constructor(code:TransferDestinationError['code']){super(`Transfer destination refused (${code}).`);
    this.name='TransferDestinationError';this.code=code;}
}
const fail=(code:TransferDestinationError['code']):never=>{throw new TransferDestinationError(code);};
function sqlCell(value:unknown):SqlCell {
  if(value===null)return null;
  if(typeof value==='string'&&value.isWellFormed())return {type:'text',value};
  if(typeof value==='number'&&Number.isFinite(value)){
    if(Number.isInteger(value)){if(!Number.isSafeInteger(value))return fail('integrity_error');
      return {type:'integer',value};}
    return {type:'real',value};
  }
  if(value instanceof Uint8Array||value instanceof ArrayBuffer)
    return {type:'blob',base64url:Buffer.from(value instanceof Uint8Array?value:new Uint8Array(value))
      .toString('base64url')};
  return fail('integrity_error');
}
function validCell(value:unknown):value is SqlCell {
  if(value===null)return true;
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const cell=value as Record<string,unknown>;
  if(cell.type==='text')return Object.keys(cell).sort().join(',')==='type,value'
    &&typeof cell.value==='string'&&cell.value.isWellFormed();
  if(cell.type==='integer'||cell.type==='real')return Object.keys(cell).sort().join(',')==='type,value'
    &&typeof cell.value==='number'&&Number.isFinite(cell.value)
    &&(cell.type==='integer'?Number.isSafeInteger(cell.value):!Number.isInteger(cell.value));
  if(cell.type==='blob'){
    if(Object.keys(cell).sort().join(',')!=='base64url,type'||typeof cell.base64url!=='string'
      ||!/^[A-Za-z0-9_-]*$/.test(cell.base64url))return false;
    return Buffer.from(cell.base64url,'base64url').toString('base64url')===cell.base64url;
  }
  return false;
}
function parameter(cell:SqlCell):unknown {
  return cell===null?null:cell.type==='blob'?Buffer.from(cell.base64url,'base64url').toString('hex'):cell.value;
}
function expression(cell:SqlCell){return cell!==null&&cell.type==='blob'?'unhex(?)':'?';}
function rowRecord(table:CapturedTable,row:CapturedRow):Record<string,SqlCell>{
  if(!Array.isArray(row.values)||row.values.length!==table.columns.length||!row.values.every(validCell))
    return fail('integrity_error');
  return Object.fromEntries(table.columns.map((column,index)=>[column,row.values[index]]));
}
function keyWhere(table:CapturedTable,row:Record<string,SqlCell>){
  const keys=table.primaryKey.map(column=>row[column]);
  if(keys.some(value=>value===null||value===undefined))return fail('integrity_error');
  return {sql:table.primaryKey.map((column,index)=>`${quote(column)}=${expression(keys[index])}`).join(' AND '),
    bindings:keys.map(parameter)};
}
async function currentRow(db:D1Database,table:CapturedTable,row:CapturedRow):Promise<CapturedRow|null>{
  const values=rowRecord(table,row),where=keyWhere(table,values);
  const result=await db.prepare(`SELECT ${table.columns.map(quote).join(',')} FROM ${quote(table.table)}
    WHERE ${where.sql} LIMIT 2`).bind(...where.bindings as D1PreparedStatement['bind'] extends (...a:infer A)=>unknown?A:never).all();
  if(result.success!==true||!Array.isArray(result.results)||result.results.length>1)return fail('unavailable');
  const found=result.results[0] as Record<string,unknown>|undefined;
  return found?{values:table.columns.map(column=>sqlCell(found[column]))}:null;
}
async function inspectRow(db:D1Database,table:CapturedTable,row:CapturedRow){
  const current=await currentRow(db,table,row);
  return current===null?'absent':JSON.stringify(current)===JSON.stringify(row)?'matching':'conflict';
}
function insert(db:D1Database,table:CapturedTable,row:CapturedRow){
  rowRecord(table,row);
  return db.prepare(`INSERT INTO ${quote(table.table)} (${table.columns.map(quote).join(',')})
    VALUES (${row.values.map(expression).join(',')})`)
    .bind(...row.values.map(parameter) as D1PreparedStatement['bind'] extends (...a:infer A)=>unknown?A:never);
}
async function writeRows(db:D1Database,table:CapturedTable,rows:readonly CapturedRow[]){
  let pending=[...rows];
  for(let attempt=0;attempt<3&&pending.length;attempt++){
    const absent:CapturedRow[]=[];
    for(const row of pending){const state=await inspectRow(db,table,row);
      if(state==='conflict')return fail('conflict');if(state==='absent')absent.push(row);}
    if(!absent.length)return;
    try{const results=await db.batch(absent.map(row=>insert(db,table,row)));
      if(!Array.isArray(results)||results.length!==absent.length||results.some(item=>item.success!==true))
        throw new Error('D1 batch response unavailable');}
    catch{/* A lost response is resolved only by reading the destination. */}
    pending=absent;
  }
  for(const row of pending){const state=await inspectRow(db,table,row);
    if(state==='conflict')return fail('conflict');if(state==='absent')return fail('outcome_unknown');}
}
async function checkedSchema(args:Args){
  if(args.expectedTarget&&JSON.stringify(args.manifest.identity.target)!==JSON.stringify(args.expectedTarget)
    ||args.expectedContextId!==undefined
      &&(args.manifest.identity.sourceContextId??'application')!==args.expectedContextId)
    return fail('conflict');
  if(args.manifest.identity.applicationId!==args.targetPlan.applicationId
    ||args.manifest.identity.modelDigest!==args.targetPlan.modelDigest
    ||args.manifest.identity.schemaObjectsDigest!==schemaDigest(args.targetPlan.objects))return fail('schema_mismatch');
  const state=await inspectCompositionSchema(args.db,args.targetPlan);
  if(state.state!=='ready'||!HASH.test(String(state.receiptId)))return fail('schema_mismatch');
  return state.receiptId as TransferDigest;
}
function checkpoint(manifest:TransferManifest):TransferCheckpoint {
  return {schemaVersion:1,revision:1,identity:manifest.identity,manifestDigest:manifest.manifestDigest,
    phase:'captured',tableCursor:null,objectCursor:null,multipart:null,
    targetSchemaReceiptId:null,targetDeploymentId:null};
}
async function save(journal:TransferJournal,prior:TransferCheckpoint,changes:Partial<TransferCheckpoint>){
  const next={...prior,...changes,revision:prior.revision+1};
  await journal.compareAndSave(prior,next);return next;
}
function equalIdentity(a:TransferCheckpoint,b:TransferCheckpoint){
  return a.manifestDigest===b.manifestDigest&&JSON.stringify(a.identity)===JSON.stringify(b.identity);
}
function body(directory:string,entry:CapturedObject){
  if(!/^object-[a-f0-9]{64}\.bin$/.test(entry.bodyFile))return fail('integrity_error');
  return path.join(directory,entry.bodyFile);
}
async function checkedBody(directory:string,entry:CapturedObject){
  const filename=body(directory,entry),stat=await lstat(filename);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==entry.size)return fail('integrity_error');
  return filename;
}
async function verifyTables(db:D1Database,manifest:TransferManifest){
  let totalRows=0;
  for(const table of manifest.tables){
    const digest=createHash('sha256');let count=0;
    for(;;){
      const result=await db.prepare(`SELECT ${table.columns.map(quote).join(',')} FROM ${quote(table.table)}
        ORDER BY ${table.primaryKey.map(quote).join(',')} LIMIT ${VERIFY_ROWS} OFFSET ?`).bind(count).all();
      if(result.success!==true||!Array.isArray(result.results))return fail('unavailable');
      for(const row of result.results as Record<string,unknown>[]){
        const captured:CapturedRow={values:table.columns.map(column=>sqlCell(row[column]))};
        digest.update(JSON.stringify(captured)+'\n');count++;
        if(count>table.rowCount)return fail('conflict');
      }
      if(result.results.length<VERIFY_ROWS)break;
    }
    if(count!==table.rowCount||`sha256-${digest.digest('hex')}`!==table.rowDigest)return fail('conflict');
    totalRows+=count;
  }
  const foreign=await db.prepare('PRAGMA foreign_key_check').all();
  if(foreign.success!==true||!Array.isArray(foreign.results)||foreign.results.length)return fail('conflict');
  return totalRows;
}
async function verifyObjects(directory:string,manifest:TransferManifest,objects:TransferObjectPort){
  const wanted=new Set<string>();let count=0,bytes=0;
  for await(const entry of readCapturedObjects(manifest,directory)){
    if(wanted.has(entry.key))return fail('integrity_error');wanted.add(entry.key);
    if(await objects.inspectObject(entry)!=='matching')return fail('conflict');
    count++;bytes+=entry.size;
  }
  if(count!==manifest.objects.count||bytes!==manifest.objects.byteLength)return fail('integrity_error');
  let observed=0;
  for await(const key of objects.listObjectKeys()){
    if(typeof key!=='string'||!wanted.delete(key))return fail('conflict');observed++;
  }
  if(wanted.size||observed!==count)return fail('conflict');
  return {count,bytes};
}

/** Source and destination profiles may differ; exact models and SQL objects may not. */
export async function verifyCapturedTransfer(args:Args):Promise<Readonly<{
  ok:true;tables:number;rows:number;objects:number;bytes:number;targetSchemaReceiptId:string}>>{
  const snapshot=await loadCapturedTransfer({config:args.config,directory:args.directory,
    transferId:args.manifest.identity.transferId});
  if(snapshot.manifestDigest!==args.manifest.manifestDigest)return fail('integrity_error');
  const receiptId=await checkedSchema(args);
  const rows=await verifyTables(args.db,args.manifest),result=await verifyObjects(args.directory,args.manifest,args.objects);
  return Object.freeze({ok:true,tables:args.manifest.tables.length,rows,objects:result.count,
    bytes:result.bytes,targetSchemaReceiptId:receiptId});
}

/** Import on a reserved target only. Every lost acknowledgement is read back before a retry. */
export async function importCapturedTransfer(args:Args&{journal:TransferJournal}):Promise<TransferCheckpoint>{
  const snapshot=await loadCapturedTransfer({config:args.config,directory:args.directory,
    transferId:args.manifest.identity.transferId});
  if(snapshot.manifestDigest!==args.manifest.manifestDigest)return fail('integrity_error');
  const receiptId=await checkedSchema(args);
  let current=await args.journal.load(args.manifest.identity.transferId);
  const initial=checkpoint(args.manifest);
  if(!current){await args.journal.create(initial);current=initial;}
  if(!equalIdentity(current,initial))return fail('conflict');
  if(current.targetSchemaReceiptId!==null&&current.targetSchemaReceiptId!==receiptId)return fail('schema_mismatch');
  if(current.phase==='delivered'||current.phase==='verified'){
    await verifyCapturedTransfer(args);return current;
  }
  current=await save(args.journal,current,{phase:'schema-ready',targetSchemaReceiptId:receiptId});
  for(const table of args.manifest.tables){
    if(!table.dataFile)continue;
    let batch:CapturedRow[]=[],offset=0;
    for await(const row of readCapturedTable(args.manifest,args.directory,table.table)){
      batch.push(row);offset++;
      if(batch.length<PAGE_ROWS&&offset!==table.rowCount)continue;
      await writeRows(args.db,table,batch);batch=[];
      current=await save(args.journal,current,{phase:'d1-copying',tableCursor:{table:table.table,rowOffset:offset}});
    }
    if(batch.length){await writeRows(args.db,table,batch);
      current=await save(args.journal,current,{phase:'d1-copying',tableCursor:{table:table.table,rowOffset:offset}});}
  }
  current=await save(args.journal,current,{phase:'r2-copying',tableCursor:null});
  let ordinal=0;
  for await(const entry of readCapturedObjects(args.manifest,args.directory)){
    let state=await args.objects.inspectObject(entry);
    if(state==='conflict')return fail('conflict');
    if(state==='absent'){
      const filename=await checkedBody(args.directory,entry);
      try{await args.objects.putObjectIfAbsent(entry,createReadStream(filename),current);}
      catch{/* Unknown upload result must be inspected. */}
      state=await args.objects.inspectObject(entry);
      if(state==='conflict')return fail('conflict');if(state!=='matching')return fail('outcome_unknown');
      // Multipart uploads checkpoint parts through the same journal. Refresh the
      // CAS revision before advancing the object cursor.
      const latest=await args.journal.load(args.manifest.identity.transferId);
      if(!latest||!equalIdentity(latest,initial))return fail('conflict');
      current=latest;
    }
    ordinal++;
    current=await save(args.journal,current,{phase:'r2-copying',objectCursor:{key:entry.key,ordinal}});
  }
  await verifyCapturedTransfer(args);
  current=await save(args.journal,current,{phase:'verified',objectCursor:null});
  return current;
}
