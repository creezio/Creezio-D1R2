import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createLocalProxy} from '../../adapters/docker/proxy.mjs';
import {LOCAL_BINDINGS, loadLocalConfiguration} from '../../scripts/local/config.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const source = name => readFile(new URL(`../../adapters/docker/${name}`, import.meta.url), 'utf8');

test('Docker dev profile reuses the native origin, bindings and one persistent state root', async () => {
  const [compose, dockerfile, ignore] = await Promise.all([source('compose.yaml'), source('Dockerfile'),
    source('Dockerfile.dockerignore')]);
  const local = loadLocalConfiguration({root});
  assert.equal(local.origin, 'http://127.0.0.1:5173');
  assert.deepEqual(LOCAL_BINDINGS, {database:'DB',bucket:'BUCKET',databaseId:'00000000-0000-4000-8000-000000000000',
    databaseName:'creezio-local',bucketName:'creezio-local'});
  assert.match(compose, /context: \.\.\/\.\./);
  assert.match(compose, /dockerfile: adapters\/docker\/Dockerfile/);
  assert.match(compose, /127\.0\.0\.1:5173:5174/);
  assert.match(compose, /local-state:\/app\/\.wrangler(?:\r?\n|$)/);
  assert.match(compose, /CREEZIO_APP_ORIGIN: http:\/\/127\.0\.0\.1:5173/);
  assert.doesNotMatch(compose, /privileged:|network_mode: host|\/var\/run\/docker\.sock/);
  assert.match(dockerfile, /FROM node:24-bookworm-slim/);
  assert.match(dockerfile, /mkdir -p \/app\/\.wrangler\/state && chown -R node:node \/app/);
  assert.match(dockerfile, /npm ci --ignore-scripts --no-audit --no-fund/);
  assert.match(dockerfile, /CMD \["node", "adapters\/docker\/serve\.mjs"\]/);
  for (const excluded of ['node_modules','.wrangler','.git','.quality','.env','.dev.vars*','.npmrc',
    '**/.quality','**/.dev.vars*','**/.npmrc']) assert.ok(ignore.split(/\r?\n/).includes(excluded));
  assert.equal(ignore.includes('.openai'), false, 'the local binding contract must enter the image');
});

test('Docker TCP bridge forwards bytes and closes without leaving a listener', async () => {
  const target = net.createServer(socket => socket.on('data', data => socket.write(data)));
  await new Promise(resolve => target.listen(0, '127.0.0.1', resolve));
  const proxy = await createLocalProxy({listenHost:'127.0.0.1',listenPort:0,targetPort:target.address().port});
  try {
    const echoed = await new Promise((resolve,reject) => {
      const client = net.connect({host:'127.0.0.1',port:proxy.address.port});
      let received = '';
      client.once('error',reject);
      client.once('connect',()=>client.write('GET / HTTP/1.1\r\nUpgrade: websocket\r\n\r\n'));
      client.on('data',data=>{
        received += data.toString();
        if (received.length >= 'GET / HTTP/1.1\r\nUpgrade: websocket\r\n\r\n'.length) {resolve(received);client.end();}
      });
    });
    assert.equal(echoed,'GET / HTTP/1.1\r\nUpgrade: websocket\r\n\r\n');
  } finally {
    await proxy.close();
    await new Promise((resolve,reject)=>target.close(error=>error?reject(error):resolve()));
  }
});
