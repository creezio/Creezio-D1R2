import {createHash,randomUUID} from 'node:crypto';
import {lstat,realpath,readFile,open,rename,unlink,readdir} from 'node:fs/promises';
import path from 'node:path';

const LIMIT=128*1024;
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const fail=code=>{throw Object.assign(new Error(`Local delivery journal ${code}.`),{code});};
/** Non-secret operator plans/provisioning only; data snapshots and publication receipts have their own journals. */
export function createLocalControlJournal(directory,prefix){
  if(!path.isAbsolute(directory)||path.resolve(directory)!==directory||!['provision','plan','sandbox','update'].includes(prefix))fail('invalid_path');
  function key(id){
    if(typeof id!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id))fail('invalid_state');
    return path.join(directory,`${prefix}-${createHash('sha256').update(id).digest('hex')}.json`);
  }
  function checked(record){
    if(!record||record.schemaVersion!==1||!Number.isSafeInteger(record.revision)||record.revision<1)fail('invalid_state');
    const id=record.plan?.transferId??record.transferId??record.updateId;
    key(id);
    const text=JSON.stringify(record)+'\n';
    if(Buffer.byteLength(text)>LIMIT)fail('limit');
    return {id,text};
  }
  async function safeDirectory(){
    for(let current=directory;;current=path.dirname(current)){
      const stat=await lstat(current);if(stat.isSymbolicLink()||!stat.isDirectory())fail('invalid_path');
      if(current===path.dirname(current))break;
    }
    const actual=await realpath(directory);
    if(process.platform==='win32'?actual.toLowerCase()!==directory.toLowerCase():actual!==directory)fail('invalid_path');
  }
  async function load(id){
    await safeDirectory();
    try{
      const file=key(id),stat=await lstat(file);
      if(!stat.isFile()||stat.isSymbolicLink()||stat.size>LIMIT)fail('invalid_state');
      const text=await readFile(file,'utf8');if(Buffer.byteLength(text)>LIMIT)fail('limit');
      const value=JSON.parse(text);if(checked(value).id!==id)fail('invalid_state');return value;
    }catch(error){if(error.code==='ENOENT')return null;throw error;}
  }
  async function commit(previous,next){
    const {id,text}=checked(next);await safeDirectory();
    const target=key(id),lockFile=target+'.lock',temporary=target+'.tmp';
    const marker=`${process.pid}:${randomUUID()}`,lock=await open(lockFile,'wx',0o600);
    let written=false;
    try{
      await lock.writeFile(marker);await lock.sync();
      const current=await load(id);
      if(!same(current,previous)||next.revision!==(previous?.revision??0)+1)fail('conflict');
      const output=await open(temporary,'wx',0o600);written=true;
      try{await output.writeFile(text);await output.sync();}finally{await output.close();}
      await rename(temporary,target);written=false;
      let dir;
      try{dir=await open(directory,'r');await dir.sync();}
      catch(error){if(process.platform!=='win32'||!['EPERM','EACCES','EINVAL','EISDIR'].includes(error.code))throw error;}
      finally{await dir?.close();}
    }finally{
      if(written)await unlink(temporary).catch(()=>{});
      const [current,held,contents]=await Promise.all([lstat(lockFile),lock.stat(),readFile(lockFile,'utf8')]);
      await lock.close();
      if(current.isSymbolicLink()||current.ino!==held.ino||current.dev!==held.dev||contents!==marker)fail('invalid_path');
      await unlink(lockFile);
    }
  }
  async function findActive(owner){
    if(!['plan','update'].includes(prefix)||typeof owner!=='string'||!owner.length)fail('invalid_state');
    await safeDirectory();const entries=await readdir(directory);
    if(entries.length>1024)fail('limit');
    let found=null;
    for(const name of entries){
      if(!new RegExp(`^${prefix}-[a-f0-9]{64}\\.json$`).test(name))continue;
      const file=path.join(directory,name),stat=await lstat(file);
      if(stat.isSymbolicLink()||!stat.isFile()||stat.size>LIMIT)fail('invalid_state');
      const value=JSON.parse(await readFile(file,'utf8'));
      const {id}=checked(value);if(key(id)!==file)fail('invalid_state');
      if(value.owner!==owner||value.stage==='delivered')continue;
      if(found)fail('transfer_conflict');found=value;
    }
    return found?.transferId??found?.updateId??null;
  }
  async function createActive(next){
    if(prefix!=='update'||typeof next?.owner!=='string'||!next.owner)fail('invalid_state');
    await safeDirectory();
    const lockFile=path.join(directory,
      `update-owner-${createHash('sha256').update(next.owner).digest('hex')}.lock`);
    let lock;
    try{lock=await open(lockFile,'wx',0o600);}
    catch(error){if(error.code==='EEXIST')fail('conflict');throw error;}
    const marker=`${process.pid}:${randomUUID()}`;
    try{
      await lock.writeFile(marker);await lock.sync();
      if(await findActive(next.owner))fail('conflict');
      await commit(null,next);
    }finally{
      const [current,held,contents]=await Promise.all([lstat(lockFile),lock.stat(),readFile(lockFile,'utf8')]);
      await lock.close();
      if(current.isSymbolicLink()||current.ino!==held.ino||current.dev!==held.dev||contents!==marker)
        fail('invalid_path');
      await unlink(lockFile);
    }
  }
  return Object.freeze({load,create:next=>commit(null,next),createActive,
    compareAndSave:commit,findActive});
}
