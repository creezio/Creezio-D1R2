import {randomUUID} from 'node:crypto';
import {openSync,writeFileSync,fsyncSync,closeSync,readFileSync,lstatSync,mkdirSync} from 'node:fs';
import path from 'node:path';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const FILE='storage-installation.json';
const INVENTORY='storage-resources.json';
const unsafe=message=>Object.assign(new Error(message),{code:'local_path'});
function location(root,createDirectory=false,name=FILE){
  if(typeof root!=='string'||!path.isAbsolute(root)||root!==path.resolve(root))
    throw unsafe('Storage installation root must be explicit and canonical.');
  const rootStat=lstatSync(root);
  if(!rootStat.isDirectory()||rootStat.isSymbolicLink())throw unsafe('Unsafe storage installation root.');
  const directory=path.join(root,'.wrangler');
  try{const stat=lstatSync(directory);if(!stat.isDirectory()||stat.isSymbolicLink())throw unsafe('Unsafe storage installation directory.');}
  catch(error){if(error?.code!=='ENOENT'||!createDirectory)throw error;mkdirSync(directory);}
  return path.join(directory,name);
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
export function loadStorageInstallationIdentityIfPresent(root){
  try{return loadStorageInstallationIdentity(root);}
  catch(error){if(error?.code==='ENOENT')return null;throw error;}
}

/** A present but partial or foreign inventory always stops startup; absence retains v1. */
export function loadLocalStorageInventory(root){
  let file;
  try{file=location(root,false,INVENTORY);}
  catch(error){if(error?.code==='ENOENT'){
    if(loadStorageInstallationIdentityIfPresent(root)!==null)
      throw new Error('Local storage inventory missing for existing installation.');
    return null;
  }throw error;}
  let bytes;
  try{
    const stat=lstatSync(file);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size<2||stat.size>16384)
      throw new Error('Invalid local storage inventory.');
    bytes=readFileSync(file);
  }catch(error){if(error?.code==='ENOENT'){
    if(loadStorageInstallationIdentityIfPresent(root)!==null)
      throw new Error('Local storage inventory missing for existing installation.');
    return null;
  }throw error;}
  let value;
  try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
  catch{throw new Error('Invalid local storage inventory.');}
  if(!value||typeof value!=='object'||Array.isArray(value)
    ||Object.keys(value).sort().join(',')!=='resources,schemaVersion,storageInstallationId'
    ||value.schemaVersion!==1||typeof value.storageInstallationId!=='string'
    ||!UUID.test(value.storageInstallationId)||!Array.isArray(value.resources)
    ||value.resources.length<1||value.resources.length>16
    ||loadStorageInstallationIdentity(root)!==value.storageInstallationId)
    throw new Error('Invalid local storage inventory.');
  return Object.freeze({schemaVersion:1,storageInstallationId:value.storageInstallationId,
    resources:value.resources});
}

/** Operator-only single write; unknown outcome is inspected, never overwritten. */
export function createLocalStorageInventory(root,value){
  const file=location(root,false,INVENTORY);
  if(!value||value.schemaVersion!==1||value.storageInstallationId!==loadStorageInstallationIdentity(root)
    ||!Array.isArray(value.resources)||value.resources.length<1)
    throw new Error('Invalid local storage inventory.');
  let handle;
  try{
    handle=openSync(file,'wx',0o600);
    writeFileSync(handle,JSON.stringify(value)+'\n');
    fsyncSync(handle);
  }finally{if(handle!==undefined)closeSync(handle);}
  return loadLocalStorageInventory(root);
}

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
