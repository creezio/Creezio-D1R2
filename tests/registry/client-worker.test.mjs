import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';

const root = fileURLToPath(new URL('../../', import.meta.url));
const origin = 'https://registry.example.invalid';
const installationToken = `cz1d_${'A'.repeat(43)}`;
const request = {projectId: 'project-1', installationId: 'installation-1', target: 'cloudflare', artifact: {
  sourceSha: 'a'.repeat(40), artifactDigest: `sha256-${'b'.repeat(64)}`, coreVersion: '1.0.0',
  contractVersion: '1', compositionDigest: `sha256-${'c'.repeat(64)}`}};
const result = {preflightId: 'preflight-1', projectId: request.projectId,
  installationId: request.installationId, checkedAt: '2026-09-27T02:00:00.000Z',
  expiresAt: '2026-09-27T02:10:00.000Z'};

test('server registry client works in the Worker runtime and refuses a provider redirect', async () => {
  const source = `import {createRegistryClient} from './core/registry/client.ts';
    const client = createRegistryClient({origin: ${JSON.stringify(origin)},
      installationToken: ${JSON.stringify(installationToken)}});
    export default {async fetch() {
      try {return Response.json({ok: true, result: await client.preflight(${JSON.stringify(request)})});}
      catch (error) {return Response.json({ok: false, code: error.code, status: error.status ?? null});}
    }};`;
  const bundle = await build({absWorkingDir: root, stdin: {contents: source, resolveDir: root,
    sourcefile: 'registry-client-worker.ts', loader: 'ts'}, bundle: true, write: false,
    platform: 'browser', format: 'esm', target: 'es2022', logLevel: 'silent'});
  const outbound = [];
  let mode = 'success';
  const runtime = new Miniflare({host: '127.0.0.1', port: 0, cf: false, modules: true,
    compatibilityDate: '2026-05-15', script: bundle.outputFiles[0].text,
    outboundService: async request => {
      outbound.push({url: request.url, method: request.method,
        authorized: request.headers.get('authorization') === `Bearer ${installationToken}`});
      if (mode === 'redirect')
        return new Response(null, {status: 303, headers: {location: 'https://unexpected.example.invalid/redirect'}});
      return Response.json(result);
    }});
  try {
    const successful = await runtime.dispatchFetch('https://client.example.invalid/check');
    assert.equal(successful.status, 200);
    assert.deepEqual(await successful.json(), {ok: true, result});
    mode = 'redirect';
    const denied = await runtime.dispatchFetch('https://client.example.invalid/check');
    assert.equal(denied.status, 200);
    assert.deepEqual(await denied.json(), {ok: false, code: 'invalid_response', status: 303});
    assert.deepEqual(outbound, [
      {url: `${origin}/v1/publications/preflight`, method: 'POST', authorized: true},
      {url: `${origin}/v1/publications/preflight`, method: 'POST', authorized: true}]);
  } finally {await runtime.dispose();}
});
