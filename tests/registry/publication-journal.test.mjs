import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rmdir, unlink, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { createFilePublicationJournal, inspectFilePublicationJournal } from '../../core/registry/file-journal.ts';
import { createPublicationGate } from '../../core/registry/publication.ts';

const artifact = { sourceSha: 'a'.repeat(40), artifactDigest: `sha256-${'b'.repeat(64)}`,
  coreVersion: '1.0.0', contractVersion: '1', compositionDigest: `sha256-${'c'.repeat(64)}` };
const request = { projectId: 'project-1', installationId: 'installation-1', target: 'cloudflare', artifact };
const preflight = { preflightId: 'preflight-1', projectId: request.projectId,
  installationId: request.installationId, checkedAt: '2026-09-27T02:00:00.000Z',
  expiresAt: '2026-09-27T02:10:00.000Z' };
const receipt = { deploymentId: 'deployment-1', url: 'https://app.example/', artifact };
const declared = { projectId: request.projectId, installationId: request.installationId,
  deploymentId: receipt.deploymentId, declaredAt: '2026-09-27T02:03:00.000Z', replayed: true };
const execFileAsync = promisify(execFile);

test('durable journal resumes a delivered publication after process restart without invoking publisher', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'creezio-publication-journal-'));
  t.after(async () => {
    for (const name of await readdir(directory)) await unlink(path.join(directory, name));
    await rmdir(directory);
  });
  let deliveryCalls = 0, declarationCalls = 0;
  const client = { preflight: async () => preflight,
    declare: async () => { declarationCalls++; if (declarationCalls === 1) throw new Error('offline'); return declared; } };
  const first = createPublicationGate({ client, journal: createFilePublicationJournal(directory),
    now: () => Date.parse(preflight.checkedAt) + 1000 });
  const pending = await first.publish(request, 'request-1', async () => { deliveryCalls++; return receipt; });
  assert.equal(pending.state, 'declaration_pending');
  assert.equal((await readdir(directory)).length, 1);

  const second = createPublicationGate({ client, journal: createFilePublicationJournal(directory),
    now: () => Date.parse(preflight.checkedAt) + 2000 });
  const outcome = await second.publish(request, 'request-1', async () => { deliveryCalls++; throw new Error('republished'); });
  assert.equal(outcome.state, 'synchronized');
  assert.equal(outcome.record.result.replayed, true);
  assert.equal(deliveryCalls, 1); assert.equal(declarationCalls, 2);
  assert.equal((await readdir(directory)).length, 1);
  assert.equal((await createFilePublicationJournal(directory).get('request-1')).state, 'synchronized');
});

test('two journal instances cannot claim the same delivery key concurrently; a stale lock refuses effects', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'creezio-publication-journal-'));
  t.after(async () => {
    for (const name of await readdir(directory)) await unlink(path.join(directory, name));
    await rmdir(directory);
  });
  const prepared = { state: 'prepared', requestKey: 'request-atomic', request, preflight };
  const a = createFilePublicationJournal(directory), b = createFilePublicationJournal(directory);
  const claims = await Promise.allSettled([a.claim(prepared), b.claim(prepared)]);
  assert.equal(claims.filter(result => result.status === 'fulfilled' && result.value === null).length, 1);
  assert.equal((await a.get(prepared.requestKey)).state, 'prepared');
  const entries = await readdir(directory);
  assert.equal(entries.length, 1);
  const file = path.join(directory, entries[0]);
  assert.doesNotMatch(await readFile(file, 'utf8'), /cz1d_/);
  await writeFile(`${file}.lock`, 'unknown owner\n');
  await assert.rejects(b.claim(prepared), { code: 'busy' });
  assert.equal((await a.get(prepared.requestKey)).state, 'prepared');
  const inspection = await inspectFilePublicationJournal(directory, prepared.requestKey);
  assert.equal(inspection.state, 'prepared');
  assert.equal(inspection.lockPresent, true);
  assert.equal(inspection.lockOwnerPid, null);
  assert.equal(inspection.temporaryPresent, false);
  assert.ok(inspection.lockModifiedAt);
});

test('competing Node processes share one atomic claim for a delivery key', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'creezio-publication-journal-'));
  t.after(async () => {
    for (const name of await readdir(directory)) await unlink(path.join(directory, name));
    await rmdir(directory);
  });
  const moduleUrl = new URL('../../core/registry/file-journal.ts', import.meta.url).href;
  const script = `import {createFilePublicationJournal} from ${JSON.stringify(moduleUrl)};
    const journal = createFilePublicationJournal(process.argv[1]);
    try { const existing = await journal.claim(JSON.parse(process.argv[2]));
      process.stdout.write(existing === null ? 'created' : 'existing'); }
    catch (error) { process.stdout.write(error.code ?? 'error'); }`;
  const payload = JSON.stringify({ state: 'prepared', requestKey: 'request-process', request, preflight });
  const attempts = await Promise.all([0, 1].map(() => execFileAsync(process.execPath,
    ['--input-type=module', '-e', script, directory, payload])));
  const outcomes = attempts.map(result => result.stdout.trim());
  assert.equal(outcomes.filter(value => value === 'created').length, 1);
  assert.ok(outcomes.every(value => ['created', 'existing', 'busy'].includes(value)));
  assert.equal((await createFilePublicationJournal(directory).get('request-process')).state, 'prepared');
});
