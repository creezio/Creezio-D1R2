import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createLocalProxy} from '../../adapters/docker/proxy.mjs';
import {dockerProxyTargets,serveDockerApplication} from '../../adapters/docker/serve.mjs';
import {LOCAL_BINDINGS, loadLocalConfiguration} from '../../scripts/local/config.mjs';
import {acquireLocalRuntimeLock} from '../../scripts/local/lock.mjs';
import {closeLocalApplication,serveLocalApplication} from '../../scripts/local/serve.mjs';
import {temporaryDirectory} from '../quality/temporary.mjs';

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
  assert.match(compose, /stop_signal: SIGUSR2/);
  assert.match(compose, /stop_grace_period: 45s/);
  assert.match(compose, /dockerfile: adapters\/docker\/Dockerfile/);
  assert.match(compose, /127\.0\.0\.1:5173:5174/);
  assert.match(compose, /127\.0\.0\.1:5175:5175/);
  assert.match(compose, /127\.0\.0\.1:5176:5177/);
  assert.match(compose, /CREEZIO_LOCAL_DELIVERY_ORIGIN: http:\/\/127\.0\.0\.1:5176/);
  assert.match(compose, /CREEZIO_WIDGET_SANDBOX_ORIGIN: http:\/\/127\.0\.0\.1:5175/);
  assert.match(compose, /CREEZIO_WIDGET_SANDBOX_BIND_HOST: 0\.0\.0\.0/);
  assert.match(compose, /local-state:\/app\/\.wrangler(?:\r?\n|$)/);
  assert.match(compose, /CREEZIO_APP_ORIGIN: http:\/\/127\.0\.0\.1:5173/);
  assert.doesNotMatch(compose, /privileged:|network_mode: host|\/var\/run\/docker\.sock/);
  assert.match(dockerfile, /FROM node:24-bookworm-slim/);
  assert.match(dockerfile, /mkdir -p \/app\/\.wrangler\/state && chown -R node:node \/app/);
  assert.match(dockerfile, /npm ci --ignore-scripts --no-audit --no-fund/);
  assert.match(dockerfile, /CMD \["node", "adapters\/docker\/serve\.mjs"\]/);
  assert.match(dockerfile, /EXPOSE 5174 5175 5177/);
  assert.match(dockerfile, /RUN node scripts\/local\/source-manifest\.mjs verify/);
  for (const excluded of ['node_modules','.wrangler','.git','.quality','.env','.dev.vars*','.npmrc',
    '**/.quality','**/.dev.vars*','**/.npmrc']) assert.ok(ignore.split(/\r?\n/).includes(excluded));
  assert.match(ignore, /\.creezio\/\*\r?\n!\.creezio\/docker-source\.json/);
  assert.equal(ignore.includes('.openai'), false, 'the local binding contract must enter the image');
});

test('Docker bridges target the configured local origins while the sandbox keeps its own port', () => {
  const standard=loadLocalConfiguration({root});
  assert.deepEqual(dockerProxyTargets(standard),{app:5173,operator:5176});
  assert.equal(standard.sandboxPort,5175);
  const isolated=loadLocalConfiguration({root,
    origin:'http://127.0.0.1:5273',
    operatorOrigin:'http://127.0.0.1:5276',
    sandboxOrigin:'http://127.0.0.1:5275',
    sandboxBindHost:'0.0.0.0'});
  assert.deepEqual(dockerProxyTargets(isolated),{app:5273,operator:5276});
  assert.equal(isolated.sandboxPort,5275);
  for(const origins of [
    {origin:'http://127.0.0.1:5174'},
    {operatorOrigin:'http://127.0.0.1:5177'},
    {sandboxOrigin:'http://127.0.0.1:5174'},
  ])assert.throws(()=>dockerProxyTargets(loadLocalConfiguration({root,...origins})),
    /reserved Docker bridge port/);
});

test('Docker runtime uses shifted bridge targets and closes both bridges on operator close failure', async () => {
  const config=loadLocalConfiguration({root,
    origin:'http://127.0.0.1:5273',
    operatorOrigin:'http://127.0.0.1:5276',
    sandboxOrigin:'http://127.0.0.1:5275'});
  const opened=[],closed=[];
  await assert.rejects(serveDockerApplication({config,
    async createProxy(options){
      opened.push(options);
      const index=opened.length;
      return {async close(){closed.push(index);if(index===2)throw new Error('operator close failed');}};
    },
    async serve(options){
      assert.equal(options.config,config);
      assert.deepEqual(options.shutdownSignals,['SIGUSR2']);
    }}),/operator close failed/);
  assert.deepEqual(opened,[{targetPort:5273},{listenPort:5177,targetPort:5276}]);
  assert.deepEqual(closed,[2,1]);
});

test('Docker stop signal closes the official runtime and releases its real storage lock', async t => {
  const isolated=temporaryDirectory(t,'creezio-docker-stop-');
  mkdirSync(path.join(isolated,'.openai'),{recursive:true});
  writeFileSync(path.join(isolated,'.openai','hosting.json'),JSON.stringify({d1:'DB',r2:'BUCKET'}));
  const config=loadLocalConfiguration({root:isolated,origin:'http://127.0.0.1:5173'});
  const lock=await acquireLocalRuntimeLock(config,'dev');
  let closeCount=0;const signals=new EventEmitter();
  const serving=serveLocalApplication({shutdownSignals:['SIGUSR2'],signalHost:signals,
    startApplication:async()=>({failure:new Promise(()=>{}),close:async()=>{closeCount++;await lock.release();}})});
  assert.equal(signals.listenerCount('SIGUSR2'),1);
  assert.equal(existsSync(config.lockPath),true);
  await new Promise(resolve=>setImmediate(resolve)); // The application is now running, not just starting.
  signals.emit('SIGUSR2');signals.emit('SIGUSR2');
  await serving;
  assert.equal(closeCount,1);
  assert.equal(existsSync(config.lockPath),false);
  assert.equal(signals.listenerCount('SIGUSR2'),0);
  const restarted=await acquireLocalRuntimeLock(config,'install');
  await restarted.release();
});

test('operator shutdown failure still closes the runtime and releases its storage lock',async t=>{
  const isolated=temporaryDirectory(t,'creezio-docker-close-');
  mkdirSync(path.join(isolated,'.openai'),{recursive:true});
  writeFileSync(path.join(isolated,'.openai','hosting.json'),JSON.stringify({d1:'DB',r2:'BUCKET'}));
  const config=loadLocalConfiguration({root:isolated,origin:'http://127.0.0.1:5173'});
  const lock=await acquireLocalRuntimeLock(config,'dev');
  let closed=0;
  await assert.rejects(closeLocalApplication({close:async()=>{throw new Error('operator close failed');}},
    {close:async()=>{closed++;await lock.release();}}),/operator close failed/);
  assert.equal(closed,1);
  assert.equal(existsSync(config.lockPath),false);
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
