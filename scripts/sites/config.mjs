import {readFileSync,lstatSync} from 'node:fs';
import path from 'node:path';
import {LOCAL_COMPATIBILITY_DATE} from '../local/config.mjs';

/** Build-time target only. Runtime values and physical resource identities belong to Sites. */
/** @param {{root: string, hostingPath?: string}} options */
export function loadSitesBuildConfiguration({root,hostingPath=process.env.CREEZIO_SITES_MANIFEST}={}) {
  if(typeof root!=='string'||!path.isAbsolute(root)||typeof hostingPath!=='string'||!path.isAbsolute(hostingPath))
    throw new Error('An explicit absolute Sites manifest is required.');
  for(let current=hostingPath;;current=path.dirname(current)){
    if(lstatSync(current).isSymbolicLink())throw new Error('Linked Sites manifest refused.');
    if(current===path.dirname(current))break;
  }
  if(!lstatSync(hostingPath).isFile()||lstatSync(hostingPath).size>4096)throw new Error('Invalid Sites manifest.');
  const hosting=JSON.parse(readFileSync(hostingPath,'utf8'));
  if(typeof hosting.project_id!=='string'||!hosting.project_id||hosting.d1!=='DB'||hosting.r2!=='BUCKET'
    ||Object.keys(hosting).some(key=>!['project_id','d1','r2'].includes(key)))throw new Error('Sites bindings or manifest differ.');
  return Object.freeze({projectId:hosting.project_id,hostingPath,profile:'sites',
    worker:{name:'creezio',main:'worker.ts',compatibility_date:LOCAL_COMPATIBILITY_DATE,
      compatibility_flags:['nodejs_compat'],vars:{CREEZIO_RUNTIME_PROFILE:'sites'},
      // Logical placeholders for the local build plugin, never provider resources or credentials.
      d1_databases:[{binding:'DB',database_name:'creezio-sites',database_id:'00000000-0000-4000-8000-000000000000'}],
      r2_buckets:[{binding:'BUCKET',bucket_name:'creezio-sites'}]}});
}
