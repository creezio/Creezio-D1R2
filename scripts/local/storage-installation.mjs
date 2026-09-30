import {randomUUID} from 'node:crypto';
import {openSync,writeFileSync,fsyncSync,closeSync,readFileSync,lstatSync,mkdirSync} from 'node:fs';
import path from 'node:path';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const FILE='storage-installation.json';
function location(root,createDirectory=false){
  if(typeof root!=='string'||!path.isAbsolute(root)||root!==path.resolve(root))
    throw new Error('Storage installation root must be explicit and canonical.');
  const rootStat=lstatSync(root);
  if(!rootStat.isDirectory()||rootStat.isSymbolicLink())throw new Error('Unsafe storage installation root.');
  const directory=path.join(root,'.wrangler');
  try{const stat=lstatSync(directory);if(!stat.isDirectory()||stat.isSymbolicLink())throw new Error('Unsafe storage installation directory.');}
  catch(error){if(error?.code!=='ENOENT'||!createDirectory)throw error;mkdirSync(directory);}
  return path.join(directory,FILE);
}
function read(file){
  const stat=lstatSync(file);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>512)throw new Error('Invalid storage installation identity.');
  const value=JSON.parse(readFileSync(file,'utf8'));
  if(!value||typeof value!=='object'||Array.isArray(value)
    ||Object.keys(value).sort().join(',')!=='schemaVersion,storageInstallationId'
    ||value.schemaVersion!==1||typeof value.storageInstallationId!=='string'
    ||!UUID.test(value.storageInstallationId))throw new Error('Invalid storage installation identity.');
  return value.storageInstallationId;
}
/** Read only: startup never creates or rotates the physical storage identity. */
export function loadStorageInstallationIdentity(root){return read(location(root));}

/** Explicit operator initialization. A partial or foreign file is preserved for inspection. */
export function createStorageInstallationIdentity(root){
  const file=location(root,true);
  try{return read(file);}catch(error){if(error?.code!=='ENOENT')throw error;}
  const id=randomUUID();
  let handle;
  try{
    handle=openSync(file,'wx',0o600);
    writeFileSync(handle,JSON.stringify({schemaVersion:1,storageInstallationId:id})+'\n');
    fsyncSync(handle);
  }catch(error){
    if(error?.code==='EEXIST')return read(file);
    throw error;
  }finally{if(handle!==undefined)closeSync(handle);}
  return read(file);
}
