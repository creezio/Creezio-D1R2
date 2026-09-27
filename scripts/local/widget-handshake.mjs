/** Dev-only IPC fence: Vite composes first, the locked parent starts the static relay, then Vite continues. */
export function awaitLocalWidgetSandboxReady(host=process,{timeoutMs=45_000}={}) {
  if(process.env.CREEZIO_LOCAL_WIDGET_HANDSHAKE!=='1')return Promise.resolve();
  if(typeof host.send!=='function'||!host.connected)return Promise.reject(new Error('Local widget handshake channel unavailable.'));
  return new Promise((resolve,reject)=>{
    let settled=false;
    const finish=error=>{
      if(settled)return;settled=true;
      clearTimeout(timer);host.off('message',onMessage);host.off('disconnect',onDisconnect);
      error?reject(error):resolve();
    };
    const onMessage=value=>{
      if(value?.version!==1)return;
      if(value.type==='creezio-widget-sandbox-ready')finish();
      else if(value.type==='creezio-local-stop'||value.type==='creezio-widget-sandbox-abort')
        finish(new Error('Local widget relay startup cancelled.'));
    };
    const onDisconnect=()=>finish(new Error('Local widget handshake disconnected.'));
    const timer=setTimeout(()=>finish(new Error('Local widget relay startup timed out.')),timeoutMs);
    host.on('message',onMessage);host.on('disconnect',onDisconnect);
    try{host.send({type:'creezio-widget-catalog-ready',version:1},error=>{
      if(error)finish(new Error('Local widget catalogue notification failed.'));
    });}catch{finish(new Error('Local widget catalogue notification failed.'));}
  });
}
