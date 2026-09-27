import '../local-environment.mjs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadLocalConfiguration} from './config.mjs';
import {createLocalRuntimeSupervisor} from './runtime-supervisor.mjs';
import {createLocalDeliveryService} from '../cloudflare/local-service.mjs';

/** App runtime and operator share one lifecycle, without giving the Worker system execution. */
export async function closeLocalApplication(delivery,supervisor){
  try{await delivery.close();}finally{await supervisor.close();}
}
export async function startLocalApplication({config=loadLocalConfiguration(),command='dev'}={}){
  let failed;const failure=new Promise(resolve=>{failed=resolve;});
  const supervisor=createLocalRuntimeSupervisor(config,{command,onFailure:failed});
  const delivery=await createLocalDeliveryService({config,supervisor});
  try{await delivery.listen();supervisor.start();}
  catch(error){await closeLocalApplication(delivery,supervisor);throw error;}
  let closing;
  return Object.freeze({config,supervisor,failure,
    close(){return closing??=closeLocalApplication(delivery,supervisor);},
  });
}
export async function serveLocalApplication({shutdownSignals=['SIGINT','SIGTERM'],
  signalHost=process,startApplication=startLocalApplication,...options}={}){
  let application,stopRequested=false,closing;
  let release;const stopped=new Promise(resolve=>{release=resolve;});
  const close=()=>closing??=(application.close().then(()=>release()).catch(()=>{process.exitCode=1;release();}));
  const stop=()=>{stopRequested=true;if(application)void close();};
  for(const signal of shutdownSignals)signalHost.on(signal,stop);
  try{
    application=await startApplication(options);
    if(stopRequested){await close();return;}
    const error=await Promise.race([stopped.then(()=>null),application.failure]);
    if(error){process.exitCode=1;console.error('Local runtime stopped unexpectedly; check its origin and storage lock.');
      await close();}
  }finally{for(const signal of shutdownSignals)signalHost.off(signal,stop);}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const command=process.argv[2]??'dev';
  if(!['dev','start'].includes(command)||process.argv.length>3)throw new Error('Expected dev or start.');
  await serveLocalApplication({command});
}
