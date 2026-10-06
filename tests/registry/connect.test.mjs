import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, readFile, lstat, readdir, rmdir, unlink} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {connectRegistryInstallation} from '../../scripts/registry/connect.mjs';

const origin = 'https://registry.example.invalid';
const download = {schemaVersion: 1, projectId: 'project-a', installationId: 'installation-a',
  target: 'cloudflare', token: `cz1d_${'a'.repeat(43)}`};
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'creezio-registry-connect-'));
  const tokenFile = path.join(root, 'download.json');
  await writeFile(tokenFile, JSON.stringify(download), {mode: 0o600});
  // Walk only this test-owned root, without following links.
  async function dispose(directory = root) {
    assert.ok(directory === root || directory.startsWith(root + path.sep));
    for (const entry of await readdir(directory, {withFileTypes: true})) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory() && !entry.isSymbolicLink()) await dispose(file); else await unlink(file);
    }
    await rmdir(directory);
  }
  return {root, tokenFile, dispose};
}
const identity = () => Response.json({projectId: download.projectId, installationId: download.installationId, target: download.target});

test('one-time download connects to the native publisher after read-only identity verification', async () => {
  const f = await fixture();
  try {
    let calls = 0;
    const fetcher = async (url, options) => {
      calls++; assert.equal(url, `${origin}/v1/installations/me`);
      assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'manual');
      assert.equal(options.headers.authorization, `Bearer ${download.token}`);
      return identity();
    };
    const result = await connectRegistryInstallation({...f, origin, target: 'cloudflare', fetcher});
    assert.equal(result.status, 'connected'); assert.equal(calls, 1);
    assert.equal(JSON.stringify(result).includes(download.token), false);
    assert.equal(result.destination, path.join(f.root, '.wrangler/delivery/registry.json'));
    assert.deepEqual(JSON.parse(await readFile(result.destination, 'utf8')), {origin,
      projectId: download.projectId, installationId: download.installationId, installationToken: download.token});
    if (process.platform !== 'win32') assert.equal((await lstat(result.destination)).mode & 0o777, 0o600);
    assert.equal((await connectRegistryInstallation({...f, origin, target: 'cloudflare', fetcher})).status, 'unchanged');
    await writeFile(f.tokenFile, JSON.stringify({...download, token: `cz1d_${'b'.repeat(43)}`}));
    await assert.rejects(connectRegistryInstallation({...f, origin, target: 'cloudflare', fetcher: identity}), {code: 'connection_exists'});
    assert.equal(JSON.parse(await readFile(result.destination, 'utf8')).installationToken, download.token);
    assert.equal((await connectRegistryInstallation({...f, origin, target: 'cloudflare', fetcher: identity, replace: true})).status, 'connected');
  } finally {await f.dispose();}
});

test('refused, revoked, redirected, oversized or mismatched identities never create a local registration', async () => {
  const f = await fixture();
  try {
    for (const fetcher of [async () => new Response(null, {status: 401}),
      async () => new Response(null, {status: 302, headers: {location: 'https://other.invalid'}}),
      async () => Response.json({projectId: 'other', installationId: download.installationId, target: 'cloudflare'}),
      async () => new Response('x'.repeat(8193)), async () => {throw new Error('provider detail');}]) {
      await assert.rejects(connectRegistryInstallation({...f, origin, target: 'cloudflare', fetcher}), {code: 'registration_refused'});
      await assert.rejects(lstat(path.join(f.root, '.wrangler')), {code: 'ENOENT'});
    }
    let calls = 0; const fetcher = async () => {calls++; return identity();};
    await assert.rejects(connectRegistryInstallation({...f, origin: 'http://registry.example.invalid', target: 'cloudflare', fetcher}), {code: 'invalid_origin'});
    await assert.rejects(connectRegistryInstallation({...f, origin, target: 'sites', fetcher}), {code: 'invalid_token_file'});
    await writeFile(f.tokenFile, JSON.stringify({...download, origin: 'https://attacker.invalid'}));
    await assert.rejects(connectRegistryInstallation({...f, origin, target: 'cloudflare', fetcher}), {code: 'invalid_token_file'});
    assert.equal(calls, 0);
  } finally {await f.dispose();}
});

test('Sites installation metadata stays in private delivery state without changing the Cloudflare target', async () => {
  const f = await fixture();
  try {
    await writeFile(f.tokenFile, JSON.stringify({...download, target: 'sites'}));
    const result = await connectRegistryInstallation({...f, origin, target: 'sites', fetcher: async () =>
      Response.json({projectId: download.projectId, installationId: download.installationId, target: 'sites'})});
    assert.equal(result.destination, path.join(f.root, '.creezio/registry/installation.json'));
    await assert.rejects(lstat(path.join(f.root, '.wrangler')), {code: 'ENOENT'});
  } finally {await f.dispose();}
});
