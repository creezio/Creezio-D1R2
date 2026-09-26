/** Local child preload only. It adds no HTTP route and never forces process termination. */
export function installRuntimeShutdownBridge(host = process) {
  if (typeof host.send !== 'function' || !host.connected) return;
  let requested = false, delivered = false, timer;
  const deliver = () => {
    if (delivered) return;
    // Vite/Wrangler install their teardown handlers while starting. Wait for that contract.
    if (host.listenerCount('SIGTERM') === 0) { timer = setTimeout(deliver, 25); timer.unref?.(); return; }
    delivered = true;
    host.emit('SIGTERM', 'SIGTERM', 0);
  };
  const request = () => { if (!requested) { requested = true; deliver(); } };
  const message = value => {
    if (value && typeof value === 'object' && value.type === 'creezio-local-stop' && value.version === 1) request();
  };
  host.on('message', message);
  host.on('disconnect', request);
  host.on('SIGINT', request);
  // A normal framework shutdown must be able to end naturally without a live IPC handle.
  host.channel?.unref();
  return () => {
    clearTimeout(timer); host.off('message', message); host.off('disconnect', request); host.off('SIGINT', request);
  };
}

installRuntimeShutdownBridge();
