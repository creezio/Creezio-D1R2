/** T32 first-publication provisioning. Journal writes are durable before every POST. */
import {CloudflareControlError} from './control-plane.mjs';
const ACCOUNT = /^[a-f0-9]{32}$/;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const NAME = /^[a-z][a-z0-9-]{1,62}[a-z0-9]$/;
const TRANSFER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export class ProvisioningError extends Error {
  constructor(code) { super(`Cloudflare provisioning ${code}.`); this.name = 'ProvisioningError'; this.code = code; }
}
const fail = code => { throw new ProvisioningError(code); };

function checkedPlan(plan, accountId) {
  if (!plan || Object.keys(plan).sort().join(',') !==
      'accountId,bucketName,databaseName,jurisdiction,tokenScope,transferId,workerName' ||
      !ACCOUNT.test(plan.accountId ?? '') || plan.accountId !== accountId ||
      !TRANSFER.test(plan.transferId ?? '') ||
      ![plan.bucketName, plan.databaseName, plan.workerName].every(name => NAME.test(name ?? '')) ||
      new Set([plan.bucketName, plan.databaseName, plan.workerName]).size !== 3 ||
      !['default', 'eu', 'us'].includes(plan.jurisdiction) ||
      !['account', 'user'].includes(plan.tokenScope)) fail('invalid_plan');
  return Object.freeze({...plan});
}

/** journal: load(transferId), create(record), compareAndSave(previous,next). */
export function createCloudflareProvisioner({control, journal, assertWorker}) {
  if (!control || !ACCOUNT.test(control.accountId ?? '') ||
      !journal || typeof journal.load !== 'function' ||
      typeof journal.create !== 'function' || typeof journal.compareAndSave !== 'function' ||
      assertWorker !== undefined && typeof assertWorker !== 'function')
    fail('invalid_configuration');
  async function checkedWorker(probe) {
    if (assertWorker) {
      if (!probe.workerExists) fail('worker_changed');
      await assertWorker();
    } else if (probe.workerExists) fail('worker_exists');
  }
  const identity = record => Object.freeze({accountId: record.plan.accountId,
    workerName: record.plan.workerName, databaseId: record.databaseId,
    bucketName: record.plan.bucketName, jurisdiction: record.plan.jurisdiction,
    origin: `https://${record.plan.workerName}.${record.subdomain}.workers.dev`});
  async function save(record, update) {
    const next = {...record, ...update, revision: record.revision + 1};
    await journal.compareAndSave(record, next);
    return next;
  }
  async function inspected(record) {
    const [database, bucket, settings, deployment] = await Promise.all([
      control.findD1(record.plan.databaseName),
      control.bucket(record.plan.bucketName, record.plan.jurisdiction),
      control.workerSettings(record.plan.workerName),
      control.workerDeployment(record.plan.workerName)
    ]);
    return {database, bucket, workerExists: settings !== null || deployment !== null};
  }
  const explicitRefusal = error => error instanceof CloudflareControlError
    && error.code === 'refused' && error.explicitRefusal === true;
  const refused = record => ({state: 'refused', resource: record.refusal.resource,
    httpStatus: record.refusal.httpStatus, providerCodes: [...record.refusal.providerCodes]});
  const unknown = (resource, observed, inspectionFailed = false) => ({state: 'unknown', resource,
    ...(resource === 'd1' ? {candidateId: observed?.id ?? null}
      : {candidateName: observed?.name ?? null}),
    ...(inspectionFailed ? {inspection: 'failed'} : {})});
  async function inspectAfterPost(record, resource, error) {
    let observed;
    try {
      observed = resource === 'd1' ? await control.findD1(record.plan.databaseName)
        : await control.bucket(record.plan.bucketName, record.plan.jurisdiction);
    } catch { return {record, result: unknown(resource, null, true)}; }
    if (explicitRefusal(error) && observed === null) {
      const refusal = {resource, httpStatus: error.status,
        providerCodes: [...error.providerCodes], observedAt: new Date().toISOString()};
      const saved = await save(record, {refusal});
      return {record: saved, result: refused(saved)};
    }
    return {record, result: unknown(resource, observed)};
  }
  async function prepare(input) {
    const plan = checkedPlan(input, control.accountId);
    const existing = await journal.load(plan.transferId);
    if (existing) {
      if (!same(existing.plan, plan)) fail('foreign_intent');
      return existing;
    }
    const [token, subdomain] = await Promise.all([
      control.verifyToken(plan.tokenScope), control.workerSubdomain()
    ]);
    const probe = await inspected({plan});
    await checkedWorker(probe);
    if (probe.database || probe.bucket) fail('resource_exists');
    const record = Object.freeze({schemaVersion: 1, revision: 1, plan,
      tokenId: token.id, subdomain, stage: 'prepared', databaseId: null,
      bucketCreatedAt: null, intentAt: null});
    await journal.create(record);
    return record;
  }
  async function provision(input) {
    const plan = checkedPlan(input, control.accountId);
    let record = await journal.load(plan.transferId);
    if (!record) record = await prepare(plan);
    if (!same(record.plan, plan)) fail('foreign_intent');
    const verified = await control.verifyToken(plan.tokenScope);
    if (verified.id !== record.tokenId) fail('token_changed');
    if (await control.workerSubdomain() !== record.subdomain) fail('subdomain_changed');
    let probe;
    try { probe = await inspected(record); }
    catch (error) {
      if (record.stage === 'd1-intent') return unknown('d1', null, true);
      if (record.stage === 'r2-intent') return unknown('r2', null, true);
      throw error;
    }
    await checkedWorker(probe);
    if (record.stage === 'd1-intent') return record.refusal?.resource === 'd1'
      && !probe.database && !probe.bucket ? refused(record) : unknown('d1', probe.database);
    if (record.stage === 'r2-intent') return record.refusal?.resource === 'r2'
      && probe.database?.id === record.databaseId && !probe.bucket
      ? refused(record) : unknown('r2', probe.bucket);
    if (record.stage === 'prepared') {
      if (probe.database || probe.bucket) fail('resource_exists');
      record = await save(record, {stage: 'd1-intent', intentAt: new Date().toISOString()});
      let created;
      try { created = await control.createD1(plan.databaseName, plan.jurisdiction); }
      catch (error) { return (await inspectAfterPost(record, 'd1', error)).result; }
      if (!UUID.test(created.id ?? '') || created.name !== plan.databaseName) fail('invalid_receipt');
      record = await save(record, {stage: 'd1-created', databaseId: created.id, intentAt: null});
      probe = await inspected(record);
    }
    if (record.stage === 'd1-created') {
      await checkedWorker(probe);
      if (!probe.database || probe.database.id !== record.databaseId || probe.bucket)
        fail('resource_conflict');
      record = await save(record, {stage: 'r2-intent', intentAt: new Date().toISOString()});
      let created;
      try { created = await control.createBucket(plan.bucketName, plan.jurisdiction); }
      catch (error) { return (await inspectAfterPost(record, 'r2', error)).result; }
      if (created.name !== plan.bucketName) fail('invalid_receipt');
      const bucket = await control.bucket(plan.bucketName, plan.jurisdiction);
      if (!bucket || !bucket.private) fail('bucket_not_private');
      record = await save(record, {stage: 'ready', bucketCreatedAt: bucket.createdAt,
        intentAt: null});
      probe = await inspected(record);
    }
    await checkedWorker(probe);
    if (record.stage !== 'ready' || !probe.database || probe.database.id !== record.databaseId ||
        !probe.bucket?.private || probe.bucket.name !== plan.bucketName)
      fail('resource_conflict');
    return {state: 'ready', target: identity(record)};
  }
  return Object.freeze({prepare, provision});
}
