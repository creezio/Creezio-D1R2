import {spawnSync} from 'node:child_process';
import {statfsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {preparePortableSource} from '../../scripts/local/source-manifest.mjs';
import {sourceIdentity,sameSourceIdentity} from '../../scripts/quality/evidence.mjs';

const MIN_FREE=20*1024*1024*1024;
/** Official Docker build: one existing checkout, one image, no Git directory in it. */
export async function buildDockerImage({root=fileURLToPath(new URL('../../',import.meta.url)),
  run=spawnSync,freeBytes}={}){
  root=path.resolve(root);
  const available=freeBytes??statfsSync(root).bavail*statfsSync(root).bsize;
  if(!Number.isFinite(available)||available<MIN_FREE)
    throw new Error('At least 20 GiB of free workspace space is required before Docker build.');
  const source=sourceIdentity(root);
  if(source.dirty)throw new Error('A clean Git checkout is required for Docker source export.');
  const manifest=await preparePortableSource(root);
  if(manifest.source.head!==source.head||manifest.source.tree!==source.tree||
      manifest.source.sha256!==source.sha256)
    throw new Error('Docker source changed during manifest export.');
  const args=['compose','-f',path.join(root,'adapters/docker/compose.yaml'),'build','app'];
  const outcome=run('docker',args,{cwd:root,stdio:'inherit',windowsHide:true,
    timeout:45*60*1000,env:{...process.env,DOCKER_BUILDKIT:'1'}});
  if(outcome.error||outcome.status!==0)throw new Error('Docker build failed.');
  const after=sourceIdentity(root);
  if(after.dirty||!sameSourceIdentity(source,after))
    throw new Error('Source changed during Docker build.');
  return {head:source.head,tree:source.tree,sha256:source.sha256,
    files:source.files.length};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{console.log(JSON.stringify(await buildDockerImage()));}
  catch{console.error('docker_build_unavailable');process.exitCode=1;}
}
