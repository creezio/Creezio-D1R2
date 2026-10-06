import '../../scripts/local-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, readdir, rmdir, unlink, lstat, symlink} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {Miniflare} from 'miniflare';
import {bootstrapRegistry} from '../../services/registry/bootstrap.ts';
import {createRegistryService} from '../../services/registry/service.ts';
import {createSitesRegistryContext} from '../../scripts/sites/registry.mjs';

const origin = 'https://registry.example.invalid';
const artifact = {sourceSha: 'a'.repeat(40), artifactDigest: `sha256-${'b'.repeat(64)}`,
  coreVersion: '1.0.0', contractVersion: '1', compositionDigest: `sha256-${'c'.repeat(64)}`};
const schema = await readFile(new URL('../../services/registry/schema.sql', import.meta.url), 'utf8');

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'creezio-sites-registry-'));
  const runtime = new Miniflare({host: '127.0.0.1', port: 0, cf: false, modules: true,
    compatibilityDate: '2026-05-15', script: 'export default {fetch(){return new Response(null,{status:404})}}',
    d1Databases: {DB: 'sites-context-test'}, d1Persist: false});
  try {
    const db = await runtime.getD1Database('DB');
    await db.batch(schema.split(';').map(item => item.trim()).filter(Boolean).map(item => db.prepare(item)));
    const service = createRegistryService({DB: db, REGISTRY_ORIGIN: origin});
    const owner = await bootstrapRegistry(db, {maintainerEmail: 'owner@example.invalid', serviceId: 'registry-primary'});
    const send = async (route, value) => {
      const response = await service.fetch(new Request(`${origin}${route}`, {method: 'POST',
        headers: {cookie: `__Host-creezio-registry-owner=${owner.ownerToken}`, origin,
          'x-creezio-request': '1', 'content-type': 'application/json'}, body: JSON.stringify(value)}));
      assert.ok(response.ok, `registry route ${route}: ${response.status}`);
      return response.json();
    };
    const project = await send('/v1/projects', {name: 'Sites witness', origin: 'https://source.example.invalid/'});
    const install = target => send('/v1/installations', {projectId: project.projectId, target});
    const directory = path.join(root, '.creezio', 'registry');
    await mkdir(directory, {recursive: true});
    const file = path.join(directory, 'installation.json');
    const save = async issued => writeFile(file, JSON.stringify({origin, projectId: project.projectId,
      installationId: issued.installationId, installationToken: issued.token}) + '\n', {mode: 0o600});
    const fetcher = (url, options) => service.fetch(new Request(url, options));
    async function dispose(directoryToRemove = root) {
      assert.ok(directoryToRemove === root || directoryToRemove.startsWith(root + path.sep));
      for (const entry of await readdir(directoryToRemove, {withFileTypes: true})) {
        const child = path.join(directoryToRemove, entry.name);
        if (entry.isDirectory() && !entry.isSymbolicLink()) await dispose(child); else await unlink(child);
      }
      await rmdir(directoryToRemove);
    }
    return {root, runtime, db, install, save, file, fetcher,
      projectId: project.projectId, close: async () => {await runtime.dispose(); await dispose();}};
  } catch (error) {await runtime.dispose(); throw error;}
}

test('Sites context uses the real registry gate, journals a lost declaration and never republishes', async () => {
  const f = await fixture();
  try {
    const issued = await f.install('sites'); await f.save(issued);
    let lost = true, deliveries = 0;
    const fetcher = async (url, options) => {
      const response = await f.fetcher(url, options);
      if (url.endsWith('/v1/deployments/declare') && lost) {lost = false; throw new Error('response lost');}
      return response;
    };
    const context = await createSitesRegistryContext({root: f.root, fetcher});
    assert.deepEqual(context.registryIdentity, {projectId: f.projectId, installationId: issued.installationId});
    const request = {projectId: f.projectId, installationId: issued.installationId, target: 'sites', artifact};
    const deliver = async () => {deliveries++; return {deploymentId: 'site-deployment-1',
      url: 'https://site.example.invalid/', publishedSha: artifact.sourceSha, artifact};};
    const first = await context.publicationGate.publish(request, 'site-source-1', deliver);
    assert.equal(first.state, 'declaration_pending');
    assert.equal(deliveries, 1);
    const resumed = await (await createSitesRegistryContext({root: f.root, fetcher})).publicationGate
      .publish(request, 'site-source-1', deliver);
    assert.equal(resumed.state, 'synchronized'); assert.equal(deliveries, 1);
    assert.equal(resumed.record.result.replayed, true);
    assert.equal((await f.db.prepare('SELECT count(*) AS count FROM registry_deployments').first()).count, 1);
    const files = await readdir(path.join(f.root, '.creezio', 'registry', 'sites-journal'));
    assert.equal(files.length, 1);
    assert.equal((await readFile(path.join(f.root, '.creezio', 'registry', 'sites-journal', files[0]), 'utf8'))
      .includes(issued.token), false);
  } finally {await f.close();}
});

test('wrong-target token or invalid private file cannot authorize a Sites delivery', async () => {
  const f = await fixture();
  try {
    const cloudflare = await f.install('cloudflare'); await f.save(cloudflare);
    const context = await createSitesRegistryContext({root: f.root, fetcher: f.fetcher});
    let deliveries = 0;
    const outcome = await context.publicationGate.publish({projectId: f.projectId,
      installationId: cloudflare.installationId, target: 'sites', artifact}, 'wrong-target',
    async () => {deliveries++; throw new Error('must not publish');});
    assert.equal(outcome.state, 'blocked'); assert.equal(deliveries, 0);
    assert.equal((await f.db.prepare('SELECT count(*) AS count FROM registry_preflights').first()).count, 0);
    await writeFile(f.file, JSON.stringify({origin, projectId: f.projectId,
      installationId: cloudflare.installationId, installationToken: cloudflare.token,
      extra: 'untrusted'}));
    await assert.rejects(createSitesRegistryContext({root: f.root, fetcher: f.fetcher}),
      {code: 'registry_registration_required'});
    await writeFile(f.file, 'x'.repeat(8193));
    await assert.rejects(createSitesRegistryContext({root: f.root, fetcher: f.fetcher}),
      {code: 'registry_registration_required'});
    assert.ok((await lstat(f.file)).isFile());
    await unlink(f.file);
    const source = path.join(f.root, 'source.json');
    await writeFile(source, JSON.stringify({origin, projectId: f.projectId,
      installationId: cloudflare.installationId, installationToken: cloudflare.token}));
    try {await symlink(source, f.file, 'file');}
    catch (error) {if (!['EPERM','EACCES'].includes(error.code)) throw error;}
    if ((await lstat(f.file).catch(() => null))?.isSymbolicLink())
      await assert.rejects(createSitesRegistryContext({root: f.root, fetcher: f.fetcher}),
        {code: 'registry_registration_required'});
  } finally {await f.close();}
});
