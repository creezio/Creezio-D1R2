import '../../scripts/local-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Miniflare} from 'miniflare';
import {contractIntegrity} from '../../sdk/contracts/validate.mjs';
import {compileCompositionSchema} from '../../scripts/data/composition-schema.mjs';
import {compileOperationSchemas} from '../../scripts/operations/schemas.mjs';
import {createOperationRegistry} from '../../core/operations/registry.ts';
import {createOperationEngine} from '../../core/operations/service.ts';
import {OPERATION_TABLES} from '../../core/operations/models.ts';
import {ACCESS_TABLES} from '../../core/identity/d1-store.ts';
import {createAccountService, provisionBootstrapCapability} from '../../core/identity/accounts.ts';
import {hostOnly} from '../../extensions/native/access/module/operations.ts';

const json = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const quote = value => `"${value.replaceAll('"','""')}"`;
const moduleId = 'creezio.access';
const manifest = json('../../extensions/native/access/module/manifest.json');
const composition = json('../../configuration/composition.json');
const lock = json('../../configuration/composition.lock.json');
lock.modules[0].contractIntegrity = contractIntegrity(manifest);
lock.compositionIntegrity = contractIntegrity(composition);
const input = {composition,lock,modules:[manifest]};
const schema = compileCompositionSchema(input);

test('native Access effects, audit detail and T06 result commit together in real D1', {timeout:60000}, async () => {
  const compiled = compileOperationSchemas(input);
  const validators = {...await import(`data:text/javascript;base64,${Buffer.from(compiled.validatorsCode).toString('base64')}`)};
  const handlers = Object.fromEntries(manifest.contracts.operations.map(item => [`${moduleId}:${item.id}`,hostOnly]));
  const registry = createOperationRegistry({catalog:compiled.catalog,validators,handlers});
  const runtime = new Miniflare({host:'127.0.0.1',port:0,cf:false,modules:true,compatibilityDate:'2026-05-15',
    script:'export default {fetch(){return new Response(null,{status:404})}}',
    d1Databases:{DB:'creezio-access-operations-qualification'},d1Persist:false});
  try {
    const db=await runtime.getD1Database('DB');
    await db.batch(schema.statements.map(item=>db.prepare(item)));
    const accounts=createAccountService(db), bootstrap=await provisionBootstrapCapability(db);
    assert.ok(bootstrap);
    const password='Synthetic Access operations qualification password';
    const owner=await accounts.bootstrap({token:bootstrap.token,loginIdentifier:'access-operations@example.invalid',
      displayName:'Access operations owner',password});
    assert.equal(owner.ok,true,JSON.stringify(owner));
    const session=await accounts.login({loginIdentifier:'access-operations@example.invalid',password,audience:'admin'});
    assert.equal(session.ok,true,JSON.stringify(session));
    const engine=createOperationEngine({db,registry,catalog:schema.runtimeCatalog,permissions:[]});
    const invoke=(operationId, value) => engine.invoke({credential:{kind:'session',token:session.token},
      moduleId,operationId,contextId:'application',audience:'admin',input:value});
    const read=await invoke('policy.read',{});
    assert.equal(read.execution.state,'succeeded');
    const initial=read.execution.output.epoch;
    const permissions=await invoke('permissions.list',{limit:50});
    assert.equal(permissions.execution.state,'succeeded');
    assert.match(permissions.execution.output.catalogDigest,/^sha256:[a-f0-9]{64}$/);
    assert.ok(permissions.execution.output.items.some(item=>item.id==='creezio.access:manage'));
    const body={requestKey:'access-delta-1',expectedEpoch:initial,
      changes:[{kind:'role-grant',roleId:'administrator',permissionId:'creezio.access:impersonate',present:true}]};
    const applied=await invoke('policy.apply-delta',body);
    assert.equal(applied.execution.state,'succeeded',JSON.stringify(applied.execution));
    assert.equal(applied.execution.output.epoch,initial+1);
    const auditId=applied.execution.output.auditId;
    const detail=await db.prepare(`SELECT from_epoch,to_epoch,changes_json FROM ${quote(ACCESS_TABLES.access_policy_audit_details)} WHERE audit_id=?`)
      .bind(auditId).first();
    assert.equal(detail.from_epoch,initial);
    assert.equal(detail.to_epoch,initial+1);
    const envelope=JSON.parse(detail.changes_json);
    assert.equal(envelope.version,1);
    assert.equal(envelope.beforePolicy.roles.find(item=>item.id==='administrator').permissionIds.includes('creezio.access:impersonate'),false);
    assert.equal(envelope.afterPolicy.roles.find(item=>item.id==='administrator').permissionIds.includes('creezio.access:impersonate'),true);
    const replay=await invoke('policy.apply-delta',body);
    assert.equal(replay.replayed,true);
    assert.equal(replay.execution.id,applied.execution.id);
    await assert.rejects(invoke('policy.apply-delta',{...body,changes:[{...body.changes[0],present:false}]}),{code:'conflict'});
    assert.equal((await db.prepare(`SELECT epoch FROM ${quote(ACCESS_TABLES.authorization_state)} WHERE id='application'`).first()).epoch,initial+1);

    // The final operation audit fails after native writes have been prepared.
    // D1 must roll back policy, native audit/detail and execution result together.
    const operationAudit=quote(OPERATION_TABLES.audit);
    await db.prepare(`CREATE TRIGGER access_test_late_audit BEFORE INSERT ON ${operationAudit}
      WHEN NEW.event='committed' BEGIN SELECT RAISE(ABORT,'forced operation audit failure'); END`).run();
    const failedBody={requestKey:'access-delta-rollback',expectedEpoch:initial+1,
      changes:[{kind:'role-override',roleId:'administrator',permissionId:'creezio.access:impersonate',effect:'deny'}]};
    await assert.rejects(invoke('policy.apply-delta',failedBody),{code:'unknown'});
    const current=await db.prepare(`SELECT epoch FROM ${quote(ACCESS_TABLES.authorization_state)} WHERE id='application'`).first();
    assert.equal(current.epoch,initial+1);
    const nativeAudits=await db.prepare(`SELECT count(*) AS n FROM ${quote(ACCESS_TABLES.access_audit)} WHERE action='authorization-updated'`).first();
    assert.equal(nativeAudits.n,1);
    const details=await db.prepare(`SELECT count(*) AS n FROM ${quote(ACCESS_TABLES.access_policy_audit_details)}`).first();
    assert.equal(details.n,1);
    const execution=await engine.lookup({credential:{kind:'session',token:session.token},moduleId,
      operationId:'policy.apply-delta',contextId:'application',audience:'admin',requestKey:failedBody.requestKey});
    assert.notEqual(execution?.state,'succeeded');
    await db.prepare('DROP TRIGGER access_test_late_audit').run();
    const ownSessions=await invoke('sessions.list',{principalId:owner.principalId,limit:50});
    assert.equal(ownSessions.execution.state,'succeeded');
    assert.ok(ownSessions.execution.output.items.some(item=>item.id===session.session.id));
    const revoked=await invoke('sessions.revoke',{sessionId:session.session.id,requestKey:'self-revoke-1'});
    assert.equal(revoked.execution.state,'succeeded','the native claim completes after revoking its source session');
    assert.equal(revoked.execution.output.sessionId,session.session.id);
    assert.equal(revoked.execution.output.revoked,true);
    await assert.rejects(engine.lookup({credential:{kind:'session',token:session.token},moduleId,
      operationId:'sessions.revoke',contextId:'application',audience:'admin',requestKey:'self-revoke-1'}),
    {code:'unauthorized'},'a revoked credential cannot read status; this does not undo its completed effect');
    const row=await db.prepare(`SELECT revoked_at_ms FROM ${quote(ACCESS_TABLES.sessions)} WHERE id=?`)
      .bind(session.session.id).first();
    assert.ok(row.revoked_at_ms!==null);
  } finally {await runtime.dispose();}
});
