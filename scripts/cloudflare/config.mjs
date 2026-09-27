import {lstatSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {LOCAL_COMPATIBILITY_DATE} from '../local/config.mjs';

const account=/^[a-f0-9]{32}$/;
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const name=/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;
const keys=['schemaVersion','accountId','workerName','databaseId','databaseName','bucketName','origin','widgetSandboxOrigin'];
function origin(value){
  try {const url=new URL(value);return typeof value==='string'&&url.origin===value&&url.protocol==='https:'
    &&!url.username&&!url.password&&url.pathname==='/'&&!url.hash&&!url.search;} catch{return false;}
}
/** Public physical target only. Provider credentials and vault keys never belong in a build manifest. */
export function validateCloudflareTarget(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==keys.length
    ||keys.some(key=>!Object.hasOwn(value,key))||value.schemaVersion!==1
    ||!account.test(value.accountId)||!uuid.test(value.databaseId)
    ||value.databaseId==='00000000-0000-4000-8000-000000000000'
    ||!name.test(value.workerName)||!name.test(value.databaseName)||!name.test(value.bucketName)
    ||!origin(value.origin)||!origin(value.widgetSandboxOrigin)||value.origin===value.widgetSandboxOrigin)
    throw new Error('Invalid Cloudflare publication target.');
  return Object.freeze({...value});
}
export function cloudflareWorkerConfiguration(target){
  const value=validateCloudflareTarget(target);
  return {name:value.workerName,account_id:value.accountId,main:'worker.ts',compatibility_date:LOCAL_COMPATIBILITY_DATE,
    compatibility_flags:['nodejs_compat'],workers_dev:true,
    vars:{CREEZIO_RUNTIME_PROFILE:'cloudflare',CREEZIO_APP_ORIGIN:value.origin,CREEZIO_WIDGET_SANDBOX_ORIGIN:value.widgetSandboxOrigin},
    d1_databases:[{binding:'DB',database_name:value.databaseName,database_id:value.databaseId}],
    r2_buckets:[{binding:'BUCKET',bucket_name:value.bucketName}]};
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
