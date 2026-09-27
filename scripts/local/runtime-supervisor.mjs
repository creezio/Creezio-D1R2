import {runLockedLocalRuntime} from '../run-framework.mjs';

/** A local publication may stop only the runtime this process launched. */
export function createLocalRuntimeSupervisor(config,{run=runLockedLocalRuntime,command='dev',onFailure=()=>{}}={}){
  let active=null,closing=false,lastFailure=null;
  return Object.freeze({
    start(){
      if(closing)throw new Error('Local supervisor is closing.');
      if(active)return;
      const abort=new AbortController(),record={abort,done:null};
      lastFailure=null;active=record;
      record.done=Promise.resolve().then(()=>run(command,config,{signal:abort.signal}))
        .then(()=>{if(!abort.signal.aborted)throw new Error('Local runtime exited.');})
        .catch(error=>{lastFailure=error;queueMicrotask(()=>onFailure(error));})
        .finally(()=>{if(active===record)active=null;});
    },
    async stop(){
      const running=active;if(!running){if(lastFailure)throw lastFailure;return;}
      running.abort.abort();await running.done;
      // Failed cleanup is not proof that the source lock or storage was released.
      if(lastFailure)throw lastFailure;
    },
    async close(){closing=true;const running=active;if(running){running.abort.abort();await running.done;}
      if(lastFailure)throw lastFailure;},
    get running(){return active!==null;},
    get closing(){return closing;},
  });
}
