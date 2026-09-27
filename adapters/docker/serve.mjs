import {createLocalProxy} from './proxy.mjs';
import {serveLocalApplication} from '../../scripts/local/serve.mjs';

const proxy = await createLocalProxy();
let deliveryProxy;
try {
  deliveryProxy=await createLocalProxy({listenPort:5177,targetPort:5176});
  // Miniflare owns SIGTERM and exits immediately, before the shared lock can close.
  await serveLocalApplication({shutdownSignals:['SIGUSR2']});
} finally {
  await deliveryProxy?.close();
  await proxy.close();
}
