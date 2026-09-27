import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
import { temporaryDirectory } from '../quality/temporary.mjs';
import { loadLocalConfiguration, localWorkerConfiguration, assertLocalBuiltConfiguration } from '../../scripts/local/config.mjs';
import { acquireLocalRuntimeLock, assertLocalStoragePaths } from '../../scripts/local/lock.mjs';
import { createTerminalIO } from '../../scripts/local/tty.mjs';
import { runLockedLocalRuntime } from '../../scripts/run-framework.mjs';
import { runLocalInstallation } from '../../scripts/local/install.mjs';
import { installRuntimeShutdownBridge } from '../../scripts/local/runtime-child-lifecycle.mjs';

function configFixture(t) {
  const root = temporaryDirectory(t, 'creezio-local-operator-');
  mkdirSync(path.join(root, '.openai'));
  writeFileSync(path.join(root, '.openai/hosting.json'), JSON.stringify({ d1: 'DB', r2: 'BUCKET' }));
  return loadLocalConfiguration({ root, origin: 'http://127.0.0.1:5173' });
}

test('local configuration ties origin, port and persistent D1 identity to one installation', t => {
  const config = configFixture(t), worker = localWorkerConfiguration(config);
  assert.equal(config.port, 5173);
  assert.equal(config.d1Path, path.join(config.root, '.wrangler/state/v3/d1'));
  assert.equal(worker.vars.CREEZIO_APP_ORIGIN, config.origin);
  assert.equal(worker.d1_databases[0].database_id, config.bindings.databaseId);
  assert.equal(worker.d1_databases[0].binding, 'DB');
  assert.ok(Object.isFrozen(config)); assert.ok(Object.isFrozen(config.bindings));
  assert.doesNotThrow(() => assertLocalBuiltConfiguration(worker, config));
  for (const alter of [
    value => { value.vars.CREEZIO_APP_ORIGIN = 'http://127.0.0.1:8787'; },
    value => { value.vars.CREEZIO_RUNTIME_PROFILE = 'cloudflare'; },
    value => { value.d1_databases[0].database_id = 'different-database'; },
    value => { value.r2_buckets[0].bucket_name = 'different-bucket'; },
  ]) {
    const changed = structuredClone(worker); alter(changed);
    assert.throws(() => assertLocalBuiltConfiguration(changed, config), /configuration differs/i);
  }
  assert.equal(loadLocalConfiguration({ root: config.root, origin: 'http://127.0.0.1:5192' }).port, 5192);
});

test('local configuration refuses remote targets, ambiguous origins and mismatched logical bindings', t => {
  const config = configFixture(t);
  for (const origin of ['https://example.com', 'http://0.0.0.0:5173', 'http://127.0.0.1:5173/',
    'http://127.0.0.1:5173/path', 'http://127.0.0.1:5173?x=1', 'http://a:b@127.0.0.1:5173',
    'http://127.0.0.1', 'http://127.0.0.1:999', 'http://127.0.0.1:99999', 'invalid']) {
    assert.throws(() => loadLocalConfiguration({ root: config.root, origin }), undefined, origin);
  }
  assert.throws(() => loadLocalConfiguration({ root: './relative' }));
  writeFileSync(path.join(config.root, '.openai/hosting.json'), JSON.stringify({ d1: 'OTHER', r2: 'BUCKET' }));
  assert.throws(() => loadLocalConfiguration({ root: config.root, origin: config.origin }));
});

test('official local storage lock serializes processes and release is idempotent', async t => {
  const config = configFixture(t);
  mkdirSync(path.dirname(config.lockPath));
  const attempts = await Promise.allSettled(['install', 'start'].map(purpose => acquireLocalRuntimeLock(config, purpose)));
  const winners = attempts.filter(result => result.status === 'fulfilled');
  assert.equal(winners.length, 1);
  assert.equal(attempts.find(result => result.status === 'rejected').reason.code, 'local_busy');
  const owner = winners[0].value;
  assert.equal(JSON.parse(readFileSync(config.lockPath, 'utf8')).nonce, owner.owner.nonce);
  await owner.release(); await owner.release();
  assert.equal(existsSync(config.lockPath), false);
  const next = await acquireLocalRuntimeLock(config, 'inspect');
  await next.release();
});

test('stale, changed or foreign lock ownership is never silently removed', async t => {
  const config = configFixture(t);
  const lock = await acquireLocalRuntimeLock(config, 'install');
  const foreign = JSON.stringify({ version: 1, pid: 2147483647, nonce: 'foreign' });
  writeFileSync(config.lockPath, foreign);
  await assert.rejects(lock.release(), error => error.code === 'local_path');
  await assert.rejects(lock.release(), error => error.code === 'local_path');
  assert.equal(readFileSync(config.lockPath, 'utf8'), foreign);
  await assert.rejects(acquireLocalRuntimeLock(config, 'start'), error => error.code === 'local_busy');
  assert.equal(readFileSync(config.lockPath, 'utf8'), foreign);
});

test('local storage refuses linked directories before opening a database or claiming a lock', async t => {
  const config = configFixture(t), destination = path.join(config.root, 'separate');
  mkdirSync(destination);
  const link = path.join(config.root, '.wrangler');
  symlinkSync(destination, link, process.platform === 'win32' ? 'junction' : 'dir');
  try {
    await assert.rejects(assertLocalStoragePaths(config), error => error.code === 'local_path');
    await assert.rejects(acquireLocalRuntimeLock(config, 'install'), error => error.code === 'local_path');
    assert.equal(existsSync(path.join(destination, 'creezio-local.lock')), false);
  } finally { unlinkSync(link); }
});

function terminalFixture() {
  const input = new PassThrough(); input.isTTY = true; input.isRaw = false;
  input.setRawMode = value => { input.isRaw = value; };
  const output = new PassThrough(); output.isTTY = true;
  let transcript = ''; output.on('data', value => { transcript += value.toString('utf8'); });
  return { input, output, io: createTerminalIO({ input, output }), transcript: () => transcript };
}

test('terminal password entry preserves Unicode without echo and restores terminal state', async () => {
  const terminal = terminalFixture();
  assert.equal(terminal.input.readableFlowing, null);
  const result = terminal.io.readSecret('Password: ');
  terminal.input.emit('keypress', 'Un secret 🔒 suffisamment long', {});
  terminal.input.emit('keypress', '', { name: 'return' });
  assert.equal(await result, 'Un secret 🔒 suffisamment long');
  assert.equal(terminal.transcript(), 'Password: \n');
  assert.equal(terminal.input.isRaw, false);
  assert.equal(terminal.input.listenerCount('keypress'), 0);
  assert.equal(terminal.input.readableFlowing, false);
  const second = terminal.io.readSecret('Again: ');
  terminal.input.emit('keypress', 'ab🔒', {});
  terminal.input.emit('keypress', '', { name: 'backspace' });
  terminal.input.emit('keypress', '', { name: 'return' });
  assert.equal(await second, 'ab');
  terminal.input.resume();
  const alreadyFlowing = terminal.io.readSecret('Active: ');
  terminal.input.emit('keypress', 'abc', {});
  terminal.input.emit('keypress', '', { name: 'return' });
  assert.equal(await alreadyFlowing, 'abc');
  assert.equal(terminal.input.readableFlowing, true);
  terminal.input.destroy(); terminal.output.destroy();
});

test('terminal cancellation and noninteractive input cannot supply credentials', async () => {
  const terminal = terminalFixture();
  const result = terminal.io.readSecret('Password: ');
  terminal.input.emit('keypress', 'never-output-this-password', {});
  terminal.input.emit('keypress', '', { ctrl: true, name: 'c' });
  await assert.rejects(result, error => error.code === 'cancelled');
  assert.equal(terminal.input.isRaw, false);
  assert.equal(terminal.input.listenerCount('keypress'), 0);
  assert.equal(terminal.transcript().includes('never-output'), false);
  terminal.input.isTTY = false;
  await assert.rejects(terminal.io.readSecret('Password: '), error => error.code === 'terminal_required');
  terminal.input.destroy(); terminal.output.destroy();
});

test('terminal rejects overlong password rather than silently using its prefix', async () => {
  const terminal = terminalFixture();
  const result = terminal.io.readSecret('Password: ');
  terminal.input.emit('keypress', 'x'.repeat(1025), {});
  terminal.input.emit('keypress', '', { name: 'return' });
  await assert.rejects(result, error => error.code === 'input_too_long');
  assert.equal(terminal.transcript().includes('xxx'), false);
  assert.equal(terminal.input.isRaw, false);
  terminal.input.destroy(); terminal.output.destroy();
});

test('local start pins the selected storage and origin and retains its lock until child close', async t => {
  const config = configFixture(t), child = new EventEmitter();
  mkdirSync(path.join(config.root, 'dist/server'), { recursive: true });
  writeFileSync(path.join(config.root, 'dist/server/wrangler.json'), JSON.stringify(localWorkerConfiguration(config)));
  let released = false, sandboxClosed = false, sandboxStarted = false, launch;
  const started = new Promise(resolve => { launch = resolve; });
  const initialListeners = { int: process.listenerCount('SIGINT'), term: process.listenerCount('SIGTERM') };
  const running = runLockedLocalRuntime('start', config, {
    startSandbox: async target => {assert.equal(target,config);sandboxStarted=true;
      return {close:async()=>{sandboxClosed=true;}};},
    acquireLock: async (target, purpose) => {
      assert.equal(target, config); assert.equal(purpose, 'start');
      return { release: async () => { released = true; } };
    },
    spawnChild: (command, args, options) => {
      assert.equal(command, process.execPath);
      const preloads = args.flatMap((value, index) => value === '--import' ? [args[index + 1]] : []);
      assert.deepEqual(preloads, ['scripts/local-environment.mjs', 'scripts/local/runtime-child-lifecycle.mjs']
        .map(relative => pathToFileURL(path.join(config.root, relative)).href));
      assert.equal(args[args.indexOf('--persist-to') + 1], config.statePath);
      assert.equal(args[args.indexOf('--port') + 1], '5173');
      assert.equal(options.cwd, config.root);
      assert.equal(options.env.CREEZIO_APP_ORIGIN, config.origin);
      assert.equal(options.env.CREEZIO_WIDGET_SANDBOX_ORIGIN,config.sandboxOrigin);
      assert.equal(sandboxStarted,true);
      assert.equal(options.windowsHide, true);
      launch(); return child;
    },
  });
  await started;
  assert.equal(released, false);
  child.emit('exit', 0); // exit alone is not the closure of inherited pipes.
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(released, false);
  child.emit('close', 0, null);
  assert.equal(await running, 0); assert.equal(released, true);assert.equal(sandboxClosed,true);
  assert.equal(process.listenerCount('SIGINT'), initialListeners.int);
  assert.equal(process.listenerCount('SIGTERM'), initialListeners.term);
});

test('local start refuses a mismatched build before launching and releases only its own lock', async t => {
  const config = configFixture(t), worker = localWorkerConfiguration(config);
  worker.vars.CREEZIO_APP_ORIGIN = 'http://127.0.0.1:8787';
  mkdirSync(path.join(config.root, 'dist/server'), { recursive: true });
  writeFileSync(path.join(config.root, 'dist/server/wrangler.json'), JSON.stringify(worker));
  let releases = 0;
  await assert.rejects(runLockedLocalRuntime('start', config, {
    acquireLock: async () => ({ release: async () => { releases++; } }),
    spawnChild: () => assert.fail('mismatched build must not open local storage'),
  }), /configuration differs/i);
  assert.equal(releases, 1);
});

test('local sandbox closes before releasing the storage lock when framework launch fails', async t => {
  const config=configFixture(t);
  mkdirSync(path.join(config.root,'dist/server'),{recursive:true});
  writeFileSync(path.join(config.root,'dist/server/wrangler.json'),JSON.stringify(localWorkerConfiguration(config)));
  const events=[];
  await assert.rejects(runLockedLocalRuntime('start',config,{
    acquireLock:async()=>({release:async()=>{events.push('unlock');}}),
    startSandbox:async()=>({close:async()=>{events.push('sandbox-close');}}),
    spawnChild:()=>{throw new Error('Synthetic launch failure');},
  }),/Synthetic launch failure/);
  assert.deepEqual(events,['sandbox-close','unlock']);
});

test('dev waits for the fresh composition before acknowledging and later closes its relay',async t=>{
  const config=configFixture(t),child=new EventEmitter(),events=[];
  child.connected=true;
  child.send=(value,callback)=>{events.push(value.type);callback?.();};
  let launch,completeSandbox;
  const started=new Promise(resolve=>{launch=resolve;});
  const sandboxReady=new Promise(resolve=>{completeSandbox=resolve;});
  const running=runLockedLocalRuntime('dev',config,{
    acquireLock:async()=>({release:async()=>{events.push('unlock');}}),
    startSandbox:async()=>{events.push('sandbox-start');await sandboxReady;
      return {close:async()=>{events.push('sandbox-close');}};},
    spawnChild:(_command,_args,options)=>{
      assert.equal(options.env.CREEZIO_LOCAL_WIDGET_HANDSHAKE,'1');
      launch();return child;
    },
  });
  await started;
  assert.equal(events.includes('sandbox-start'),false);
  child.emit('message',{type:'creezio-widget-catalog-ready',version:1});
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(events,['sandbox-start']);
  completeSandbox();
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(events,['sandbox-start','creezio-widget-sandbox-ready']);
  child.emit('close',0,null);
  assert.equal(await running,0);
  assert.deepEqual(events,['sandbox-start','creezio-widget-sandbox-ready','sandbox-close','unlock']);
});

test('dev composition timeout stops its startup child and releases the lock after close',async t=>{
  const config=configFixture(t),child=new EventEmitter(),events=[];
  child.kill=signal=>{events.push(`kill:${signal}`);setImmediate(()=>child.emit('close',null,signal));return true;};
  await assert.rejects(runLockedLocalRuntime('dev',config,{
    handshakeTimeoutMs:10,
    acquireLock:async()=>({release:async()=>{events.push('unlock');}}),
    startSandbox:async()=>assert.fail('stale catalog must not start before composition'),
    spawnChild:()=>child,
  }),/Local runtime could not be launched/);
  assert.deepEqual(events,['kill:SIGTERM','unlock']);
});

test('local shutdown bridge waits for framework teardown, delivers once and leaves no referenced IPC channel', async () => {
  const host = new EventEmitter(); host.connected = true; host.send = () => {};
  let unrefs = 0, delivered = 0;
  host.channel = { unref() { unrefs++; } };
  const cleanup = installRuntimeShutdownBridge(host);
  try {
    assert.equal(unrefs, 1);
    host.emit('message', { type: 'irrelevant', version: 1 });
    host.emit('message', { type: 'creezio-local-stop', version: 2 });
    assert.equal(delivered, 0);
    host.emit('message', { type: 'creezio-local-stop', version: 1 });
    assert.equal(delivered, 0);
    const shutdown = new Promise(resolve => host.on('SIGTERM', () => { delivered++; resolve(); }));
    await Promise.race([shutdown, new Promise((_, reject) => setTimeout(() => reject(new Error('No framework teardown signal')), 1000).unref())]);
    assert.equal(delivered, 1);
    host.emit('SIGINT'); host.emit('disconnect'); host.emit('message', { type: 'creezio-local-stop', version: 1 });
    assert.equal(delivered, 1);
  } finally { cleanup(); }
  assert.equal(host.listenerCount('message'), 0);
  assert.equal(host.listenerCount('SIGINT'), 0);
  assert.equal(host.listenerCount('disconnect'), 0);
});

function installationFixture(t, { state = 'fresh', confirm = true, cleanupFails = false, installFails = false } = {}) {
  const config = configFixture(t), events = [], output = [], db = {}, plan = { sqlDigest: `sha256-${'a'.repeat(64)}` };
  const password = 'Synthetic operator password never logged';
  let lines = 0;
  const io = { interactive: true, write: value => output.push(value),
    readLine: async () => { events.push('line'); return lines++ === 0 ? 'owner@example.invalid' : 'Synthetic operator'; },
    readSecret: async () => { events.push('secret'); return password; },
    confirm: async () => { events.push('confirm'); return confirm; } };
  const engine = {
    loadAccessInstallPlan: root => { assert.equal(root, config.root); events.push('plan'); return plan; },
    inspectAccessInstallation: async (database, supplied) => {
      assert.equal(database, db); assert.equal(supplied, plan); events.push('inspect');
      return { state, bootstrap: state === 'schema_ready' ? 'none' : state === 'bootstrap_expired' ? 'expired' : undefined };
    },
    installAccess: async (database, supplied, options) => {
      events.push('install'); assert.equal(database, db); assert.equal(supplied, plan);
      assert.equal(options.expectedSqlDigest, plan.sqlDigest); assert.equal(options.createSchema, state === 'fresh');
      assert.deepEqual(options.credentials, { loginIdentifier: 'owner@example.invalid', displayName: 'Synthetic operator', password });
      if (installFails) throw new Error(`Private failure ${password}`);
      return { ok: true, code: 'installed', effect: 'confirmed', stage: 'bootstrap', token: password };
    },
  };
  const adapter = async () => { events.push('open'); return { db, dispose: async () => {
    events.push('dispose'); if (cleanupFails) throw new Error('private cleanup diagnostic');
  } }; };
  const lock = async () => { events.push('lock'); return { release: async () => { events.push('release'); } }; };
  return { args: { mode: 'install', config, io, engine, adapter, lock }, events, output, password };
}

test('operator confirms concrete target after private credentials and emits a redacted receipt', async t => {
  const fixture = installationFixture(t);
  const result = await runLocalInstallation(fixture.args);
  assert.deepEqual(fixture.events, ['plan', 'lock', 'open', 'inspect', 'line', 'line', 'secret', 'secret', 'confirm', 'plan', 'install', 'dispose', 'release']);
  assert.deepEqual(result, { ok: true, code: 'installed', effect: 'confirmed', stage: 'bootstrap' });
  assert.equal(JSON.stringify([result, fixture.output]).includes(fixture.password), false);
  assert.ok(fixture.output.some(line => line.includes(fixture.args.config.d1Path)));
  assert.ok(fixture.output.some(line => line.includes(`sha256-${'a'.repeat(64)}`)));
});

test('operator inspection and cancellation never create schema or account', async t => {
  for (const mode of ['inspect', 'install']) {
    const fixture = installationFixture(t, { confirm: false }); fixture.args.mode = mode;
    const result = await runLocalInstallation(fixture.args);
    assert.equal(result.effect, 'none'); assert.equal(fixture.events.includes('install'), false);
    assert.deepEqual(fixture.events.slice(-2), ['dispose', 'release']);
    if (mode === 'inspect') assert.equal(fixture.events.includes('secret'), false);
    else assert.equal(result.code, 'cancelled');
  }
});

test('operator refuses live, consumed or incompatible installation without collecting a password', async t => {
  for (const state of ['bootstrap_live', 'initialized', 'blocked', 'unavailable']) {
    const fixture = installationFixture(t, { state });
    const result = await runLocalInstallation(fixture.args);
    assert.equal(result.ok, false); assert.equal(result.effect, 'none');
    assert.equal(fixture.events.includes('secret'), false); assert.equal(fixture.events.includes('install'), false);
    assert.deepEqual(fixture.events.slice(-2), ['dispose', 'release']);
  }
});

test('operator private input validation and noninteractive refusal happen before mutation', async t => {
  const invalid = installationFixture(t); invalid.args.io.readSecret = async () => 'too short';
  assert.equal((await runLocalInstallation(invalid.args)).code, 'invalid_input');
  assert.equal(invalid.events.includes('install'), false);
  assert.equal(invalid.events.includes('confirm'), false);
  const terminal = installationFixture(t); terminal.args.io.interactive = false;
  assert.equal((await runLocalInstallation(terminal.args)).code, 'terminal_required');
  assert.deepEqual(terminal.events, []);
});

test('operator uncertain effect never becomes success and uncertain closure retains storage lock', async t => {
  const failed = installationFixture(t, { installFails: true });
  const result = await runLocalInstallation(failed.args);
  assert.deepEqual(result, { ok: false, code: 'installation_failed', effect: 'unknown' });
  assert.equal(JSON.stringify([result, failed.output]).includes(failed.password), false);
  assert.deepEqual(failed.events.slice(-2), ['dispose', 'release']);
  const unclosed = installationFixture(t, { cleanupFails: true });
  const unresolved = await runLocalInstallation(unclosed.args);
  assert.equal(unresolved.ok, false); assert.equal(unresolved.code, 'local_cleanup_failed');
  assert.equal(unclosed.events.includes('release'), false);
  const failedOpening = installationFixture(t);
  failedOpening.args.adapter = async () => { throw Object.assign(new Error('Private disposal detail'), { code: 'local_cleanup_failed' }); };
  const openResult = await runLocalInstallation(failedOpening.args);
  assert.equal(openResult.ok, false); assert.equal(openResult.code, 'local_cleanup_failed');
  assert.equal(failedOpening.events.includes('release'), false);
});

test('operator refuses source changes during the credential and confirmation prompts', async t => {
  const fixture = installationFixture(t);
  let loads = 0;
  fixture.args.engine.loadAccessInstallPlan = () => ({ sqlDigest: `sha256-${(loads++ ? 'b' : 'a').repeat(64)}` });
  fixture.args.engine.inspectAccessInstallation = async () => ({ state: 'fresh', bootstrap: 'none' });
  const result = await runLocalInstallation(fixture.args);
  assert.equal(result.ok, false); assert.equal(result.code, 'source_changed');
  assert.equal(result.effect, 'none'); assert.equal(fixture.events.includes('install'), false);
  assert.deepEqual(fixture.events.slice(-2), ['dispose', 'release']);
});
