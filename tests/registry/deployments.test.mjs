import '../../scripts/local-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Miniflare} from 'miniflare';
import {readOwnerDeployments} from '../../services/registry/deployments.ts';

const schema = readFileSync(new URL('../../services/registry/schema.sql', import.meta.url), 'utf8');
const artifact = {sourceSha: 'a'.repeat(40), artifactDigest: `sha256-${'b'.repeat(64)}`,
  coreVersion: '1.2.3', contractVersion: '1.0.0', compositionDigest: `sha256-${'c'.repeat(64)}`};

async function fixture() {
  const runtime = new Miniflare({host: '127.0.0.1', port: 0, cf: false, modules: true,
    compatibilityDate: '2026-05-15', script: 'export default {fetch(){return new Response(null,{status:404})}}',
    d1Databases: {DB: 'registry-deployments-test'}, d1Persist: false});
  try {
    const db = await runtime.getD1Database('DB');
    await db.batch(schema.split(';').map(item => item.trim()).filter(Boolean).map(item => db.prepare(item)));
    for (const owner of ['first', 'second']) {
      await db.prepare('INSERT INTO registry_owners(id,method,subject,email,verified_at_ms) VALUES(?,?,?,?,?)')
        .bind(owner, 'email', `${owner}@example.invalid`, `${owner}@example.invalid`, 1000).run();
      await db.prepare('INSERT INTO registry_owner_sessions(digest,owner_id,expires_at_ms,revoked_at_ms) VALUES(?,?,?,NULL)')
        .bind(`session-${owner}`, owner, 100000).run();
      await db.prepare('INSERT INTO registry_projects(id,owner_id,name,origin,created_at_ms) VALUES(?,?,?,?,?)')
        .bind(`project-${owner}`, owner, owner, `https://${owner}.example.invalid/`, 1000).run();
      await db.prepare(`INSERT INTO registry_installations
        (id,project_id,target,token_digest,token_version,revoked_at_ms,created_at_ms,rotated_at_ms)
        VALUES(?,?,?,?,1,NULL,?,NULL)`)
        .bind(`installation-${owner}`, `project-${owner}`, 'sites', `token-${owner}`, 1000).run();
    }
    return {db, close: () => runtime.dispose()};
  } catch (error) {await runtime.dispose(); throw error;}
}

async function declare(db, owner, number) {
  const id = `${owner}-${String(number).padStart(3, '0')}`;
  await db.prepare(`INSERT INTO registry_deployments
    (id,project_id,installation_id,request_key_digest,payload_digest,deployment_id,url,
      repository_url,published_sha,artifact_json,declared_at_ms)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(id, `project-${owner}`, `installation-${owner}`, `request-${id}`, `payload-${id}`,
      `deployment-${id}`, `https://${owner}.example.invalid/${id}`,
      `https://git.example.invalid/${owner}/private`, 'a'.repeat(40), JSON.stringify(artifact), number).run();
}

test('deployment read is owner scoped, includes only declared metadata and rejects stale sessions', async () => {
  const f = await fixture();
  try {
    await declare(f.db, 'first', 1);
    await declare(f.db, 'second', 1);
    const actor = {id: 'first', digest: 'session-first'};
    const own = await readOwnerDeployments(f.db, actor, 'installation-first', 2000);
    assert.equal(own.installationId, 'installation-first');
    assert.equal(own.complete, true);
    assert.equal(own.limit, 100);
    assert.equal(own.deployments.length, 1);
    assert.deepEqual(own.deployments[0], {
      declarationId: 'first-001', deploymentId: 'deployment-first-001',
      url: 'https://first.example.invalid/first-001',
      repositoryUrl: 'https://git.example.invalid/first/private', publishedSha: 'a'.repeat(40),
      artifact, declaredAt: new Date(1).toISOString(), evidenceKind: 'authenticated_declaration',
    });
    assert.equal(JSON.stringify(own).includes('request-first'), false);
    assert.equal(JSON.stringify(own).includes('token-first'), false);
    assert.equal(await readOwnerDeployments(f.db, actor, 'installation-second', 2000), null);
    assert.equal(await readOwnerDeployments(f.db, actor, 'missing', 2000), null);
    assert.deepEqual((await readOwnerDeployments(f.db, {id: 'second', digest: 'session-second'},
      'installation-first', 2000)), null);
    await f.db.prepare('UPDATE registry_owner_sessions SET revoked_at_ms=? WHERE digest=?')
      .bind(2001, actor.digest).run();
    assert.equal(await readOwnerDeployments(f.db, actor, 'installation-first', 2002), null);
  } finally {await f.close();}
});

test('deployment read keeps empty installations visible, bounds history and follows current owner', async () => {
  const f = await fixture();
  try {
    const first = {id: 'first', digest: 'session-first'};
    const empty = await readOwnerDeployments(f.db, first, 'installation-first', 2000);
    assert.deepEqual(empty, {installationId: 'installation-first', deployments: [], complete: true, limit: 100});
    for (let number = 1; number <= 101; number++) await declare(f.db, 'first', number);
    const history = await readOwnerDeployments(f.db, first, 'installation-first', 2000);
    assert.equal(history.deployments.length, 100);
    assert.equal(history.complete, false);
    assert.equal(history.deployments[0].deploymentId, 'deployment-first-101');
    assert.equal(history.deployments.at(-1).deploymentId, 'deployment-first-002');
    await f.db.prepare('UPDATE registry_projects SET owner_id=? WHERE id=?')
      .bind('second', 'project-first').run();
    assert.equal(await readOwnerDeployments(f.db, first, 'installation-first', 2000), null);
    assert.equal((await readOwnerDeployments(f.db, {id: 'second', digest: 'session-second'},
      'installation-first', 2000)).deployments.length, 100);
  } finally {await f.close();}
});
