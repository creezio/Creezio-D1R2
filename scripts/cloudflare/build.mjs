import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync,lstatSync} from 'node:fs';
import {loadCloudflareBuildConfiguration} from './config.mjs';
import {loadCompositionSchema} from '../data/composition-schema.mjs';
import {loadRuntimeComposition} from '../build/compose-runtime.mjs';
import {sourceIdentity,sameSourceIdentity} from '../quality/evidence.mjs';
import {measureRuntimeArtifacts} from '../quality/runtime.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const configuration=loadCloudflareBuildConfiguration({root});
const compositionPath=process.env.CREEZIO_COMPOSITION;
const lockPath=process.env.CREEZIO_COMPOSITION_LOCK;
if(!compositionPath||!lockPath)throw new Error('Explicit target composition and lock required.');
const options={root,compositionPath,lockPath};
if(loadRuntimeComposition(options).composition.host.profile!=='cloudflare')throw new Error('Cloudflare composition required.');
const plan=await loadCompositionSchema(options);
const source=sourceIdentity(root),started=new Date().toISOString();
const result=spawnSync(process.execPath,[path.join(root,'scripts/run-framework.mjs'),'build'],{
  cwd:root,stdio:'inherit',windowsHide:true,env:{...process.env,CREEZIO_BUILD_PROFILE:'cloudflare',
    CREEZIO_CLOUDFLARE_TARGET:configuration.targetPath,CREEZIO_COMPOSITION:compositionPath,CREEZIO_COMPOSITION_LOCK:lockPath},
});
if(result.error)throw result.error;
process.exitCode=result.status??1;
if(result.status===0){
  if(!sameSourceIdentity(source,sourceIdentity(root)))throw new Error('Source changed during Cloudflare build.');
  const artifact=measureRuntimeArtifacts(root);
  const directory=path.join(root,'.quality'),file=path.join(directory,'cloudflare-build.json');
  for(const location of [directory,file])if(lstatSync(location,{throwIfNoEntry:false})?.isSymbolicLink())throw new Error('Linked build evidence refused.');
  mkdirSync(directory,{recursive:true});
  writeFileSync(file,JSON.stringify({schemaVersion:1,started,finished:new Date().toISOString(),
    target:configuration.target,source,compositionDigest:plan.compositionDigest,planDigest:plan.planDigest,artifact},null,2)+'\n');
}
