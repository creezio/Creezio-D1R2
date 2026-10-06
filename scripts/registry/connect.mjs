import {constants} from 'node:fs';
import {lstat, mkdir, open, rename, unlink} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const identifier = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const tokenPattern = /^cz1d_[A-Za-z0-9_-]{43}$/;
function fail(code) {throw Object.assign(new Error(code), {code});}
function originValue(value) {
  let url; try {url = new URL(value);} catch {fail('invalid_origin');}
  if (url.protocol !== 'https:' || url.origin !== value || url.username || url.password) fail('invalid_origin');
  return value;
}
async function privateDirectory(directory) {
  try {await mkdir(directory, {mode: 0o700});} catch (error) {if (error.code !== 'EEXIST') throw error;}
  const stat = await lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail('unsafe_path');
}
async function boundedFile(file) {
  const before = await lstat(file);
  if (!before.isFile() || before.isSymbolicLink() || before.size > 8192) fail('invalid_token_file');
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 8192 || stat.ino !== before.ino || stat.dev !== before.dev) fail('invalid_token_file');
    const bytes = Buffer.alloc(8193), {bytesRead} = await handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead > 8192) fail('invalid_token_file');
    return bytes.subarray(0, bytesRead).toString('utf8');
  } finally {await handle.close();}
}

/** Import the registry's one-time download. No credential is accepted on the command line. */
export async function connectRegistryInstallation({root, tokenFile, origin, target, replace = false, fetcher = fetch}) {
  origin = originValue(origin);
  if (!['cloudflare', 'sites'].includes(target) || !path.isAbsolute(root) || !path.isAbsolute(tokenFile)) fail('invalid_input');
  const rootStat = await lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) fail('unsafe_path');
  let download;
  try {download = JSON.parse(await boundedFile(tokenFile));} catch (error) {fail(error.code === 'unsafe_path' ? error.code : 'invalid_token_file');}
  if (!download || Object.keys(download).sort().join(',') !== 'installationId,projectId,schemaVersion,target,token'
    || download.schemaVersion !== 1 || download.target !== target || !identifier.test(download.projectId ?? '')
    || !identifier.test(download.installationId ?? '') || !tokenPattern.test(download.token ?? '')) fail('invalid_token_file');
  // The caller supplies the trusted origin separately: a downloaded file cannot redirect its credential.
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 10_000);
  let response, reader;
  try {
    response = await fetcher(`${origin}/v1/installations/me`, {method: 'GET', redirect: 'manual',
      headers: {authorization: `Bearer ${download.token}`, accept: 'application/json'},
      cache: 'no-store', credentials: 'omit', signal: controller.signal});
    if (!response.ok || !response.body) fail('registration_refused');
    reader = response.body.getReader();
    let body = '', bytes = 0, chunks = 0;
    const decoder = new TextDecoder('utf-8', {fatal: true});
    for (;;) {
      const part = await reader.read(); if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 8192 || ++chunks > 8193) fail('registration_refused');
      body += decoder.decode(part.value, {stream: true});
    }
    body += decoder.decode();
    const identity = JSON.parse(body);
    if (!identity || Object.keys(identity).sort().join(',') !== 'installationId,projectId,target'
      || identity.projectId !== download.projectId || identity.installationId !== download.installationId
      || identity.target !== target) fail('registration_refused');
  } catch {fail('registration_refused');}
  finally {clearTimeout(timer); controller.abort(); try {await reader?.cancel();} catch {}}

  const parent = path.join(root, target === 'cloudflare' ? '.wrangler' : '.creezio');
  const directory = path.join(parent, target === 'cloudflare' ? 'delivery' : 'registry');
  await privateDirectory(parent); await privateDirectory(directory);
  const destination = path.join(directory, target === 'cloudflare' ? 'registry.json' : 'installation.json');
  const lock = path.join(directory, '.registry-connect.lock');
  let lease; try {lease = await open(lock, 'wx', 0o600);} catch {fail('connection_busy');}
  const temporary = path.join(directory, `.registry-connect-${crypto.randomUUID()}.tmp`);
  let temporaryCreated = false;
  try {
    const output = JSON.stringify({origin, projectId: download.projectId, installationId: download.installationId,
      installationToken: download.token}) + '\n';
    let previous;
    try {previous = await boundedFile(destination);} catch (error) {if (error.code !== 'ENOENT') throw error;}
    if (previous !== undefined && previous !== output && !replace) fail('connection_exists');
    if (previous === output) return {status: 'unchanged', target, projectId: download.projectId, installationId: download.installationId, destination};
    const handle = await open(temporary, 'wx', 0o600); temporaryCreated = true;
    try {await handle.writeFile(output); await handle.sync();} finally {await handle.close();}
    await rename(temporary, destination); temporaryCreated = false;
    return {status: 'connected', target, projectId: download.projectId, installationId: download.installationId, destination};
  } finally {
    if (temporaryCreated) await unlink(temporary);
    await lease.close(); await unlink(lock);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), values = {}, allowed = new Set(['--file', '--origin', '--target']);
  try {
    let replace = false;
    for (let index = 0; index < args.length; index++) {
      if (args[index] === '--replace-existing' && !replace) {replace = true; continue;}
      if (!allowed.has(args[index]) || values[args[index]] !== undefined || !args[index + 1]) fail('invalid_input');
      const key = args[index]; values[key] = args[++index];
    }
    if (!values['--file'] || !values['--origin'] || !values['--target']) fail('invalid_input');
    console.log(JSON.stringify(await connectRegistryInstallation({root: process.cwd(),
      tokenFile: path.resolve(values['--file']), origin: values['--origin'], target: values['--target'], replace})));
  } catch (error) {
    const known = new Set(['invalid_origin','invalid_input','unsafe_path','invalid_token_file','registration_refused','connection_exists','connection_busy']);
    console.error(JSON.stringify({error: known.has(error?.code) ? error.code : 'connection_failed'}));
    process.exitCode = 1;
  }
}
