import net from 'node:net';

/** Forward raw TCP, including Vite WebSocket upgrades, to the fixed local origin. */
export async function createLocalProxy({listenHost = '0.0.0.0', listenPort = 5174,
  targetHost = '127.0.0.1', targetPort = 5173} = {}) {
  const sockets = new Set();
  const server = net.createServer(client => {
    const upstream = net.connect({host: targetHost, port: targetPort});
    sockets.add(client); sockets.add(upstream);
    const end = () => {client.destroy(); upstream.destroy();};
    client.on('error', end); upstream.on('error', end);
    client.on('close', () => sockets.delete(client));
    upstream.on('close', () => sockets.delete(upstream));
    client.pipe(upstream); upstream.pipe(client);
  });
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(listenPort, listenHost, () => {server.off('error', reject); resolve();});
    });
  } catch (error) {server.close(); throw error;}
  let closing;
  return Object.freeze({address: server.address(), close() {
    return closing ??= new Promise((resolve, reject) => {
      for (const socket of sockets) socket.destroy();
      server.close(error => error ? reject(error) : resolve());
    });
  }});
}
