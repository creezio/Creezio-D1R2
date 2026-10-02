import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {lstatSync,readFileSync} from 'node:fs';
import {createLocalProxy} from './proxy.mjs';
import {LOCAL_REPOSITORY_ROOT,loadLocalConfiguration} from '../../scripts/local/config.mjs';
import {serveLocalApplication} from '../../scripts/local/serve.mjs';
import {sourceIdentity} from '../../scripts/quality/evidence.mjs';

/** Run a corrected operator against an independently attested application source. */
export function dockerApplicationConfiguration(args=[]){
  if(args.length===0)return loadLocalConfiguration();
  if(args.length!==2||args[0]!=='--application-root'||typeof args[1]!=='string'
    ||!path.isAbsolute(args[1])||path.resolve(args[1])!==args[1])
    throw new Error('Expected --application-root <absolute path>.');
  const root=args[1];
  for(let current=root;;current=path.dirname(current)){
    if(lstatSync(current).isSymbolicLink())throw new Error('Linked application source path.');
    if(current===path.dirname(current))break;
  }
  const config=loadLocalConfiguration({root});
  const source=sourceIdentity(config.root);
  if(source.dirty||!/^[a-f0-9]{40}$/.test(source.head)
    ||!/^[a-f0-9]{40}$/.test(source.tree)||!/^[a-f0-9]{64}$/.test(source.sha256))
    throw new Error('Unverified application source.');
  if(!readFileSync(path.join(config.root,'package-lock.json'))
    .equals(readFileSync(path.join(LOCAL_REPOSITORY_ROOT,'package-lock.json'))))
    throw new Error('Application dependency lock differs from the operator.');
  return config;
}

export function dockerProxyTargets(config=loadLocalConfiguration()) {
  if([config.port,config.operatorPort,config.sandboxPort].some(port=>port===5174||port===5177))
    throw new Error('Local origin conflicts with a reserved Docker bridge port.');
  return Object.freeze({app:config.port,operator:config.operatorPort});
}

export async function serveDockerApplication({config=loadLocalConfiguration(),
  createProxy=createLocalProxy,serve=serveLocalApplication}={}) {
  const targets=dockerProxyTargets(config);
  const proxy=await createProxy({targetPort:targets.app});
  let deliveryProxy;
  try {
    deliveryProxy=await createProxy({listenPort:5177,targetPort:targets.operator});
    // Miniflare owns SIGTERM and exits immediately, before the shared lock can close.
    await serve({shutdownSignals:['SIGUSR2'],config});
  } finally {
    try{await deliveryProxy?.close();}finally{await proxy.close();}
  }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
  await serveDockerApplication({config:dockerApplicationConfiguration(process.argv.slice(2))});
