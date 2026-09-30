import {lstatSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {LOCAL_COMPATIBILITY_DATE} from '../local/config.mjs';
import {resourceBindingNames,validateStorageRoutes} from '../../adapters/storage/resources.ts';

const account=/^[a-f0-9]{32}$/;
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const storageUuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const name=/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;
const keys=['schemaVersion','accountId','workerName','databaseId','databaseName','bucketName','origin','widgetSandboxOrigin'];
function origin(value){
  try {const url=new URL(value);return typeof value==='string'&&url.origin===value&&url.protocol==='https:'
    &&!url.username&&!url.password&&url.pathname==='/'&&!url.hash&&!url.search;} catch{return false;}
}
/** Public physical target only. Provider credentials and vault keys never belong in a build manifest. */
export function validateCloudflareTarget(value){
  const additional=value?.schemaVersion===2||value?.schemaVersion===3;
  const wanted=additional?[...keys,'resources',...(value.schemaVersion===3?['storageInstallationId']:[])]:keys;
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==wanted.length
    ||wanted.some(key=>!Object.hasOwn(value,key))||![1,2,3].includes(value.schemaVersion)
    ||typeof value.accountId!=='string'||!account.test(value.accountId)
    ||typeof value.databaseId!=='string'||!uuid.test(value.databaseId)
    ||value.databaseId==='00000000-0000-4000-8000-000000000000'
    ||typeof value.workerName!=='string'||!name.test(value.workerName)
    ||typeof value.databaseName!=='string'||!name.test(value.databaseName)
    ||typeof value.bucketName!=='string'||!name.test(value.bucketName)
    ||!origin(value.origin)||!origin(value.widgetSandboxOrigin)||value.origin===value.widgetSandboxOrigin)
    throw new Error('Invalid Cloudflare publication target.');
  if(value.schemaVersion===3&&(typeof value.storageInstallationId!=='string'
    ||!storageUuid.test(value.storageInstallationId)))throw new Error('Invalid Cloudflare storage installation.');
  if(!additional)return Object.freeze({...value});
  if(!Array.isArray(value.resources)||value.resources.length<1||value.resources.length>16)
    throw new Error('Invalid Cloudflare storage resources.');
  const routes=validateStorageRoutes({schemaVersion:1,routes:value.resources.map(item=>({
    contextId:item?.contextId,slot:item?.slot,status:item?.status}))});
  const names=new Set([value.databaseName,value.bucketName]);
  const ids=new Set([value.databaseId]);
  const resources=value.resources.map((item,index)=>{
    if(!item||typeof item!=='object'||Array.isArray(item)
      ||Object.keys(item).sort().join(',')!=='bucketName,contextId,databaseId,databaseName,slot,status'
      ||typeof item.databaseName!=='string'||!name.test(item.databaseName)
      ||typeof item.databaseId!=='string'||!uuid.test(item.databaseId)
      ||typeof item.bucketName!=='string'||!name.test(item.bucketName)
      ||item.databaseId==='00000000-0000-4000-8000-000000000000'
      ||names.has(item.databaseName)||names.has(item.bucketName)||ids.has(item.databaseId)
      ||item.contextId!==routes.routes[index].contextId||item.slot!==routes.routes[index].slot
      ||item.status!==routes.routes[index].status)throw new Error('Invalid Cloudflare storage resources.');
    names.add(item.databaseName);names.add(item.bucketName);ids.add(item.databaseId);
    return Object.freeze({...item});
  });
  return Object.freeze({...value,resources:Object.freeze(resources)});
}
export function cloudflareWorkerConfiguration(target){
  const value=validateCloudflareTarget(target);
  const resources=value.schemaVersion>=2?value.resources:[];
  const active=resources.filter(item=>item.status==='active');
  return {name:value.workerName,account_id:value.accountId,main:'worker.ts',compatibility_date:LOCAL_COMPATIBILITY_DATE,
    compatibility_flags:['nodejs_compat'],workers_dev:true,
    vars:{CREEZIO_RUNTIME_PROFILE:'cloudflare',CREEZIO_APP_ORIGIN:value.origin,CREEZIO_WIDGET_SANDBOX_ORIGIN:value.widgetSandboxOrigin,
      ...(resources.length?{CREEZIO_STORAGE_ROUTES:JSON.stringify({
        schemaVersion:value.schemaVersion===3?2:1,
        ...(value.schemaVersion===3?{storageInstallationId:value.storageInstallationId}:{}),
        routes:resources.map(({contextId,slot,status})=>({contextId,slot,status}))})}:{})},
    d1_databases:[{binding:'DB',database_name:value.databaseName,database_id:value.databaseId},
      ...active.map(item=>({binding:resourceBindingNames(item.slot).database,database_name:item.databaseName,database_id:item.databaseId}))],
    r2_buckets:[{binding:'BUCKET',bucket_name:value.bucketName},
      ...active.map(item=>({binding:resourceBindingNames(item.slot).bucket,bucket_name:item.bucketName}))]};
}
/** @param {{root:string,targetPath?:string}} options */
export function loadCloudflareBuildConfiguration({root,targetPath=process.env.CREEZIO_CLOUDFLARE_TARGET}={}){
  if(typeof root!=='string'||!path.isAbsolute(root)||typeof targetPath!=='string'||!path.isAbsolute(targetPath))
    throw new Error('An explicit absolute Cloudflare target manifest is required.');
  for(let current=targetPath;;current=path.dirname(current)){
    if(lstatSync(current).isSymbolicLink())throw new Error('Linked Cloudflare manifest refused.');
    if(current===path.dirname(current))break;
  }
  const stat=lstatSync(targetPath);
  if(!stat.isFile()||stat.size>8192)throw new Error('Invalid Cloudflare manifest.');
  const target=validateCloudflareTarget(JSON.parse(readFileSync(targetPath,'utf8')));
  return Object.freeze({profile:'cloudflare',targetPath,target,worker:cloudflareWorkerConfiguration(target)});
}
export function assertCloudflareBuiltConfiguration(actual,target){
  const expected=cloudflareWorkerConfiguration(target);
  for(const key of ['name','account_id','compatibility_date','workers_dev'])
    if(actual?.[key]!==expected[key])throw new Error('Built Cloudflare target differs.');
  for(const key of ['vars','d1_databases','r2_buckets','compatibility_flags'])
    if(JSON.stringify(actual?.[key])!==JSON.stringify(expected[key]))throw new Error('Built Cloudflare bindings differ.');
}
