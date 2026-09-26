import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, scryptSync } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';

const root = fileURLToPath(new URL('../../', import.meta.url));
const password = new TextEncoder().encode('Creezio T04 — synthetic qualification only');
const salt = Uint8Array.from({ length: 16 }, (_, index) => index + 1);
// Independent policy expectations: never import these from the candidate under test.
const expectedProfiles = {
  scrypt: { parameters: { N: 32768, r: 8, p: 3, dkLen: 32, maxmem: 41943040 }, declaredWorkingBytes: 33558528 },
  argon2id: { parameters: { m: 19456, t: 2, p: 1, version: 19, dkLen: 32, maxmem: 25165824 }, declaredWorkingBytes: 19922944 },
};
const expectedArgon2id = '19f56965225ad8cf1c07f2c64f442aef18df55fb59534dc961c644882190edc0';

function assertProfile(body, profile, expectedDigest) {
  assert.deepEqual(body.parameters, expectedProfiles[profile].parameters);
  assert.equal(body.declaredWorkingBytes, expectedProfiles[profile].declaredWorkingBytes);
  assert.equal(body.profile, profile);
  assert.equal(body.mode, 'synchronous');
  assert.equal(body.outputHex, expectedDigest);
}

test('bounded KDF qualification: workerd vectors, fixed costs, admission and synchronous timings', { timeout: 60000 }, async t => {
  const bundled = await build({ absWorkingDir: root, entryPoints: ['tests/identity/harness/crypto-worker.ts'],
    bundle: true, write: false, metafile: true, platform: 'browser', format: 'esm', target: 'es2022', logLevel: 'silent' });
  const script = bundled.outputFiles[0].text;
  const report = { profile: 't04-crypto-local-qualification', started: new Date().toISOString(), status: 'running',
    package: '@noble/hashes@2.4.0', runtime: 'workerd@1.20260515.1',
    bundle: { bytes: Buffer.byteLength(script), sha256: createHash('sha256').update(script).digest('hex'),
      inputs: Object.keys(bundled.metafile.inputs).sort() },
    measurements: {}, limits: ['Timings are outside-worker wall clock, not hosted CPU billing',
      'Declared KDF buffers are not measured isolate heap or process RSS',
      'Synchronous KDF blocks its isolate; request timeout cannot preempt this computation',
      'Admission fixture proves at most one accepted holder, not fairness under a blocked event loop',
      'No Sites/Cloudflare claim, account, database, real password or authentication implementation'] };
  const mf = new Miniflare({ host: '127.0.0.1', port: 0, cf: false, modules: true, script,
    compatibilityDate: '2026-05-15' });
  let failed = false;
  // This watchdog runs outside workerd. A timeout aborts the experiment and disposes its process;
  // it is not an application-level promise that can interrupt synchronous CPU in the Worker.
  async function bounded(operation) {
    let timer;
    try {
      return await Promise.race([Promise.resolve().then(operation), new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('External qualification deadline exceeded (5000 ms).')), 5000);
      })]);
    } finally { clearTimeout(timer); }
  }
  async function request(path, init = { method: 'POST' }) {
    return bounded(async () => {
      const response = await mf.dispatchFetch(`http://qualification${path}`, init);
      const text = await response.text();
      if (text && !response.headers.get('content-type')?.includes('application/json')) throw new Error(`Unexpected workerd response ${response.status}: ${text.slice(0, 1000)}`);
      return { status: response.status, body: text ? JSON.parse(text) : null };
    });
  }
  async function check(name, run) {
    await t.test(name, async () => {
      try { await run(); } catch (error) { failed = true; throw error; }
    });
    // Do not continue expensive cases after any failed conformance or deadline.
    if (failed) throw new Error(`Qualification stopped after failed check: ${name}`);
  }
  try {
    await bounded(() => mf.ready);
    await check('Argon2id RFC 9106 fixture matches the published independent vector', async () => {
      const response = await request('/rfc-argon2id');
      assert.equal(response.status, 200);
      assert.equal(response.body.outputHex, '0d640df58d78766c08c037a34a8b53c9d01ef0452d75b65eb52520e96b01e659');
      assert.equal(response.body.conformanceOnly, true);
    });
    await check('probe rejects caller-selected costs, input bodies and invalid methods', async () => {
      assert.equal((await request('/scrypt?N=2')).status, 400);
      assert.equal((await request('/scrypt', { method: 'POST', body: 'synthetic-override' })).status, 400);
      assert.equal((await request('/scrypt', { method: 'GET' })).status, 405);
      assert.equal((await request('/unknown')).status, 404);
    });
    await check('a held admission permit rejects another derivation before allocation', async () => {
      // Observe rejection immediately, even while another request is being checked.
      const holder = request('/admission/hold').then(value => ({ value }), error => ({ error }));
      try {
        let occupied = false;
        for (let attempt = 0; attempt < 10; attempt++) {
          occupied = (await request('/admission/status', { method: 'GET' })).body.admitted;
          if (occupied) break;
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        assert.equal(occupied, true);
        const refused = await request('/scrypt');
        assert.equal(refused.status, 429); assert.equal(refused.body.error, 'qualification_busy');
      } finally {
        const settled = await holder;
        if (settled.error) throw settled.error;
        assert.equal(settled.value.status, 200);
      }
      assert.equal((await request('/admission/status', { method: 'GET' })).body.admitted, false);
    });
    const expectedScrypt = scryptSync(password, salt, 32, { N: 32768, r: 8, p: 3, maxmem: 40 * 1024 * 1024 }).toString('hex');
    for (const profile of ['scrypt', 'argon2id']) {
      await check(`${profile}: one warm-up and three fixed-cost measurements finish within the external bound`, async () => {
        const warmup = await request(`/${profile}`);
        assert.equal(warmup.status, 200);
        const expected = profile === 'scrypt' ? expectedScrypt : expectedArgon2id;
        assertProfile(warmup.body, profile, expected);
        const result = { mode: 'synchronous', parameters: warmup.body.parameters,
          outputHex: expected, declaredWorkingBytes: warmup.body.declaredWorkingBytes,
          warmupRuns: 1, measuredRuns: 3, wallMs: [], outputConformance: profile === 'scrypt' ? 'independent-node-crypto' : 'rfc-vector-and-fixed-policy-fixture' };
        report.measurements[profile] = result;
        for (let index = 0; index < 3; index++) {
          const start = performance.now();
          const measured = await request(`/${profile}`);
          const duration = performance.now() - start;
          assert.equal(measured.status, 200); assertProfile(measured.body, profile, expected);
          assert.ok(duration < 5000);
          result.wallMs.push(duration);
        }
      });
    }
    report.status = 'passed';
  } finally {
    await mf.dispose();
    if (report.status !== 'passed') report.status = 'failed';
    report.finished = new Date().toISOString();
    t.diagnostic(JSON.stringify(report));
  }
});
