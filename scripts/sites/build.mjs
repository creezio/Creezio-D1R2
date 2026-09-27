import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync,lstatSync} from 'node:fs';
import {loadSitesBuildConfiguration} from './config.mjs';
import {prepareSitesSchema} from './schema.mjs';
import {loadCompositionSchema} from '../data/composition-schema.mjs';
import {sourceIdentity,sameSourceIdentity} from '../quality/evidence.mjs';
import {measureRuntimeArtifacts} from '../quality/runtime.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const hostingPath=process.env.CREEZIO_SITES_MANIFEST??path.join(root,'.openai/hosting.json');
const configuration=loadSitesBuildConfiguration({root,hostingPath});
const compositionPath=process.env.CREEZIO_COMPOSITION??'configuration/composition.sites.json';
const lockPath=process.env.CREEZIO_COMPOSITION_LOCK??compositionPath.replace(/\.json$/,'.lock.json');
const plan=await loadCompositionSchema({root,compositionPath,lockPath});
prepareSitesSchema(plan,path.dirname(path.dirname(configuration.hostingPath)));
const source=sourceIdentity(root),started=new Date().toISOString();
const result=spawnSync(process.execPath,[path.join(root,'scripts/run-framework.mjs'),'build'],{
  cwd:root,stdio:'inherit',windowsHide:true,env:{...process.env,CREEZIO_BUILD_PROFILE:'sites',
    CREEZIO_SITES_MANIFEST:configuration.hostingPath,CREEZIO_COMPOSITION:compositionPath,CREEZIO_COMPOSITION_LOCK:lockPath},
});
if(result.error)throw result.error;
process.exitCode=result.status??1;
if(result.status===0){
  if(!sameSourceIdentity(source,sourceIdentity(root)))throw new Error('Source changed during Sites build.');
  const artifact=measureRuntimeArtifacts(root);
  const directory=path.join(root,'.quality'),file=path.join(directory,'sites-build.json');
  for(const location of [directory,file])if(lstatSync(location,{throwIfNoEntry:false})?.isSymbolicLink())throw new Error('Linked build evidence refused.');
  mkdirSync(directory,{recursive:true});
  writeFileSync(file,JSON.stringify({schemaVersion:1,started,finished:new Date().toISOString(),
    projectId:configuration.projectId,source,compositionDigest:plan.compositionDigest,
    planDigest:plan.planDigest,artifact},null,2)+'\n');
}
