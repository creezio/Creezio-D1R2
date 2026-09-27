import {createHash,randomUUID} from 'node:crypto';
import {lstat,open,readFile,realpath,rename,unlink} from 'node:fs/promises';
import path from 'node:path';
import type {TransferCheckpoint,TransferJournal} from './types.ts';

const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const HASH=/^sha256-[a-f0-9]{64}$/;
const MAX_BYTES=131_072; // Covers 256 bounded part receipts plus one pending intent.
export class TransferJournalError extends Error {
  readonly code:'invalid_path'|'invalid_state'|'busy'|'unavailable';
  constructor(code:TransferJournalError['code']){super(`Transfer journal failed (${code}).`);
    this.name='TransferJournalError';this.code=code;}
}
const fail=(code:TransferJournalError['code']):never=>{throw new TransferJournalError(code);};
function filename(directory:string,id:string){
  if(!ID.test(id))return fail('invalid_state');
  return path.join(directory,`transfer-${createHash('sha256').update(id).digest('hex')}.json`);
}
async function directorySafe(directory:string){
  try{
    const stat=await lstat(directory),resolved=await realpath(directory);
    if(!stat.isDirectory()||stat.isSymbolicLink()||
      (process.platform==='win32'?resolved.toLowerCase()!==directory.toLowerCase():resolved!==directory))throw 0;
  }catch{return fail('invalid_path');}
}
const plain=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'
  &&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
const exact=(value:Record<string,unknown>,keys:readonly string[])=>Object.keys(value).sort().join(',')
  ===[...keys].sort().join(',');
function validMultipart(value:unknown):boolean {
  if(!plain(value)||!(exact(value,['key','uploadId','completedParts'])
    ||exact(value,['key','uploadId','completedParts','pendingPart']))
    ||typeof value.key!=='string'||typeof value.uploadId!=='string'
    ||!Array.isArray(value.completedParts)||value.completedParts.length>256
    ||value.completedParts.some((part,index)=>!plain(part)||!exact(part,['number','etag','sha256'])
      ||part.number!==index+1||typeof part.etag!=='string'||!part.etag||part.etag.length>256
      ||!/^[a-f0-9]{64}$/.test(String(part.sha256))))return false;
  if(!Object.prototype.hasOwnProperty.call(value,'pendingPart')||value.pendingPart===null)return true;
  const part=value.pendingPart;
  return plain(part)&&exact(part,['number','size','sha256','md5'])
    &&value.completedParts.length<256
    &&part.number===value.completedParts.length+1
    &&Number.isSafeInteger(part.size)&&Number(part.size)>0&&Number(part.size)<=8*1024*1024
    &&/^[a-f0-9]{64}$/.test(String(part.sha256))&&/^[a-f0-9]{32}$/.test(String(part.md5));
}
function checked(value:unknown):TransferCheckpoint {
  if(!plain(value)||!exact(value,['schemaVersion','revision','identity','manifestDigest','phase',
    'tableCursor','objectCursor','multipart','targetSchemaReceiptId','targetDeploymentId'])
    ||value.schemaVersion!==1||!Number.isSafeInteger(value.revision)||Number(value.revision)<1
    ||!plain(value.identity)||!exact(value.identity,['transferId','applicationId','sourceSha',
      'compositionDigest','lockDigest','modelDigest','schemaObjectsDigest','planDigest','sourceSchemaReceiptId','target'])
    ||!plain(value.identity.target)||!exact(value.identity.target,['accountId','workerName','databaseId',
      'bucketName','origin'])||!ID.test(String(value.identity.transferId))
    ||!HASH.test(String(value.manifestDigest))||!HASH.test(String(value.identity.planDigest))
    ||!['captured','schema-ready','d1-copying','r2-copying','secrets-ready','verified','delivery-unknown','delivered'].includes(String(value.phase))
    ||value.tableCursor!==null&&(!plain(value.tableCursor)||!exact(value.tableCursor,['table','rowOffset'])
      ||typeof value.tableCursor.table!=='string'
      ||!Number.isSafeInteger(value.tableCursor.rowOffset)||Number(value.tableCursor.rowOffset)<0)
    ||value.objectCursor!==null&&(!plain(value.objectCursor)||!exact(value.objectCursor,['key','ordinal'])
      ||typeof value.objectCursor.key!=='string'
      ||!Number.isSafeInteger(value.objectCursor.ordinal)||Number(value.objectCursor.ordinal)<0)
    ||value.multipart!==null&&!validMultipart(value.multipart)
    ||value.targetSchemaReceiptId!==null&&!HASH.test(String(value.targetSchemaReceiptId))
    ||value.targetDeploymentId!==null&&typeof value.targetDeploymentId!=='string')return fail('invalid_state');
  return value as unknown as TransferCheckpoint;
}
async function read(file:string):Promise<TransferCheckpoint|null>{
  try{
    const stat=await lstat(file);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size>MAX_BYTES)return fail('invalid_state');
    const bytes=await readFile(file);
    if(bytes.byteLength>MAX_BYTES)return fail('invalid_state');
    return checked(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));
  }catch(error){
    if((error as NodeJS.ErrnoException).code==='ENOENT')return null;
    if(error instanceof TransferJournalError)throw error;
    return fail('invalid_state');
  }
}
async function syncDirectory(directory:string){
  let handle;
  try{handle=await open(directory,'r');await handle.sync();}
  catch(error){if(process.platform!=='win32'||!['EPERM','EACCES','EINVAL','EISDIR']
    .includes((error as NodeJS.ErrnoException).code??''))return fail('unavailable');}
  finally{await handle?.close().catch(()=>{});}
}
async function write(file:string,value:TransferCheckpoint){
  const bytes=new TextEncoder().encode(JSON.stringify(checked(value))+'\n');
  if(bytes.byteLength>MAX_BYTES)return fail('invalid_state');
  const temp=`${file}.tmp`;
  let handle,created=false;
  try{handle=await open(temp,'wx',0o600);created=true;await handle.writeFile(bytes);await handle.sync();
    await handle.close();handle=undefined;await rename(temp,file);await syncDirectory(path.dirname(file));}
  catch(error){await handle?.close().catch(()=>{});if(created)await unlink(temp).catch(()=>{});
    throw error instanceof TransferJournalError?error:new TransferJournalError('unavailable');}
}
export function createFileTransferJournal(directory:string):TransferJournal {
  if(typeof directory!=='string'||!path.isAbsolute(directory)||path.resolve(directory)!==directory)
    return fail('invalid_path');
  async function locked<T>(id:string,action:(file:string)=>Promise<T>){
    await directorySafe(directory);
    const file=filename(directory,id),lock=`${file}.lock`,marker=`${process.pid}:${randomUUID()}\n`;
    let handle;
    try{handle=await open(lock,'wx',0o600);await handle.writeFile(marker);await handle.sync();}
    catch(error){await handle?.close().catch(()=>{});
      if((error as NodeJS.ErrnoException).code==='EEXIST')return fail('busy');return fail('unavailable');}
    try{return await action(file);}
    finally{
      try{const [stat,held,contents]=await Promise.all([lstat(lock),handle.stat(),readFile(lock,'utf8')]);
        if(!stat.isFile()||stat.isSymbolicLink()||stat.dev!==held.dev||stat.ino!==held.ino
          ||contents!==marker)return fail('invalid_path');
        await handle.close();await unlink(lock);
      }catch(error){await handle.close().catch(()=>{});
        throw error instanceof TransferJournalError?error:new TransferJournalError('unavailable');}
    }
  }
  return Object.freeze({
    async load(transferId:string){await directorySafe(directory);return read(filename(directory,transferId));},
    async create(checkpoint:TransferCheckpoint){
      const record=checked(checkpoint);
      await locked(record.identity.transferId,async file=>{if(await read(file))return fail('invalid_state');
        await write(file,record);});
    },
    async compareAndSave(previous:TransferCheckpoint,next:TransferCheckpoint){
      const before=checked(previous),after=checked(next);
      if(after.revision!==before.revision+1||after.identity.transferId!==before.identity.transferId
        ||after.manifestDigest!==before.manifestDigest
        ||JSON.stringify(after.identity)!==JSON.stringify(before.identity))return fail('invalid_state');
      await locked(before.identity.transferId,async file=>{
        if(JSON.stringify(await read(file))!==JSON.stringify(before))return fail('invalid_state');
        await write(file,after);
      });
    },
  });
}
