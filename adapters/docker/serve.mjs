import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createLocalProxy} from './proxy.mjs';
import {loadLocalConfiguration} from '../../scripts/local/config.mjs';
import {serveLocalApplication} from '../../scripts/local/serve.mjs';

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
  await serveDockerApplication();
