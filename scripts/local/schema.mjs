import '../local-environment.mjs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {loadLocalConfiguration} from './config.mjs';
import {acquireLocalRuntimeLock} from './lock.mjs';
import {openLocalAccessDatabase,openLocalStoragePair} from './database.mjs';
import {installedRouteInput} from './install.mjs';
import {createTerminalIO} from './tty.mjs';
import {STORAGE_AUTHORITY_TABLES} from '../../core/storage-authority/models.ts';
import {ACCESS_TABLES} from '../../core/identity/d1-store.ts';
import {prepareStorageRevocation,fenceStorageRoute,readStorageMutation,inspectStorageRevocation,
  claimStorageSourceAttemptBatch,confirmStorageSource,reopenStorageRoute,
  inspectStorageRouteOpen} from '../../core/storage-authority/coordinator.ts';

const hash = /^sha256-[a-f0-9]{64}$/;
const states = new Set(['ready', 'additive', 'blocked', 'unavailable']);
const refusal = (code, effect = 'none') => Object.freeze({ok: false, code, effect});
const safeCode = value => typeof value === 'string' && /^[a-z][a-z0-9._-]{0,63}$/.test(value)
  ? value : 'schema_failed';
const sameSource = (left, right) => ['planDigest', 'modelDigest', 'sqlDigest',
  'compositionDigest', 'lockDigest'].every(key => left?.[key] === right?.[key]);
const routeTable = `"${STORAGE_AUTHORITY_TABLES.storage_routes}"`;
const authTable = `"${ACCESS_TABLES.authorization_state}"`;
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const exactSchema = (managed, plan) => managed?.ok === true && managed.receipt
  && sameSource(managed.receipt, plan) && hash.test(managed.receiptId);
const sameReceiptPlan = (left, right) => left && right && sameSource(left, right);
const routedInput = (config, plan, resource, generation) => {
  const commandDigest = `sha256-${digest(['local.schema.apply', config.storageInstallationId,
    plan.planDigest, config.storageResources.map(item => [item.contextId,item.slot,item.status,
      item.databaseId,item.bucketName])])}`;
  return {installationId:config.storageInstallationId, contextId:resource.contextId,
    slot:resource.slot, expectedGeneration:generation, commandDigest,
    mutationId:`local-schema:${digest([commandDigest,resource.contextId,resource.slot,
      resource.databaseId,resource.bucketName]).slice(0,48)}`};
};
const stop = (code, effect = 'none') => { throw Object.assign(new Error(code), {code, effect}); };

/** One stopped-runtime schema cutover. The primary is the sole durable intent journal. */
async function runRoutedSchema({mode,config,io,adapter,engine,lock}) {
  if (!Array.isArray(config.storageResources) || !config.storageResources.some(item => item.status === 'active'))
    return refusal('invalid_storage_resources');
  if (mode === 'apply' && io.interactive === false) return refusal('terminal_required');
  let lease, result = refusal('schema_failed'), writeStarted = false, closureUnknown = false;
  const opened = [];
  try {
    engine ??= {...await import('../data/install-composition.mjs'), ...await import('../data/apply-schema.mjs')};
    const plan = await engine.loadComposedInstallPlan(config.root);
    if (!hash.test(plan?.planDigest)) return refusal('invalid_plan');
    lease = await lock(config, mode === 'apply' ? 'install' : 'inspect');
    const connect = async contextId => { const connection = await adapter(config,contextId);
      opened.push(connection); return connection; };
    const primary = await connect('application');
    const targets = [];
    for (const resource of config.storageResources.filter(item => item.status === 'active'))
      targets.push({resource,connection:await connect(resource.contextId)});
    const all = [{contextId:'application',connection:primary},...targets.map(item =>
      ({contextId:item.resource.contextId,connection:item.connection}))];
    const inspectAll = async () => {
      const inspected = [];
      for (const item of all) {
        const managed = await engine.inspectManagedSchema(item.connection.db);
        const schema = await engine.inspectCompositionSchema(item.connection.db,plan);
        if (!managed || typeof managed.ok !== 'boolean' || !states.has(schema?.state)
          || !Array.isArray(schema.additions)||!Array.isArray(schema.columnAdditions))
          stop('invalid_inspection');
        inspected.push({...item,managed,schema});
      }
      return inspected;
    };
    let inspected = await inspectAll();
    const primaryReceipt = inspected[0].managed.receipt;
    if (!primaryReceipt || !hash.test(inspected[0].managed.receiptId))
      stop('schema_unmanaged');
    const entries = [];
    const source = await primary.db.prepare(`SELECT epoch FROM ${authTable}
      WHERE id='application' LIMIT 2`).first();
    if (!Number.isSafeInteger(source?.epoch) || source.epoch < 1)
      stop('source_unconfirmed');
    for (const {resource,connection} of targets) {
      const template = routedInput(config,plan,resource,1);
      const journal = await readStorageMutation(primary.db,template.mutationId);
      if (journal && (journal.installationId !== template.installationId
        || journal.contextId !== template.contextId
        || journal.commandDigest !== template.commandDigest)) stop('route_changed');
      const row = await connection.db.prepare(`SELECT generation,state,mutation_id AS mutationId,
        source_epoch AS sourceEpoch FROM ${routeTable}
        WHERE id=? AND installation_id=? AND slot=? LIMIT 2`)
        .bind(resource.contextId,config.storageInstallationId,resource.slot).first();
      const authorityAdvanced=journal?.state==='open'&&row?.state==='active'
        &&Number.isSafeInteger(row.generation)&&row.generation>journal.generation+1;
      const lineage=authorityAdvanced
        ?await installedRouteInput(primary.db,config,plan,resource,row):null;
      const lineageState=lineage?await inspectStorageRevocation(primary.db,lineage):null;
      if(authorityAdvanced&&(!lineage||row.sourceEpoch!==source.epoch
        ||lineageState!=='open'))stop('route_unconfirmed');
      const generation=authorityAdvanced?lineage.expectedGeneration
        :journal?.generation??row?.generation;
      if (!Number.isSafeInteger(generation) || generation < 1) stop('route_unconfirmed');
      const input = authorityAdvanced?lineage:routedInput(config,plan,resource,generation);
      const state = authorityAdvanced?'open':journal?.state??null;
      if (!row || (state === null ? row.state !== 'active' || row.sourceEpoch !== source.epoch
        : !['prepared','fenced','source-attempted','source-confirmed','open'].includes(state)
          || !['active','deny'].includes(row.state)
          || (row.state === 'deny' && (row.generation !== generation+1
            || row.mutationId !== input.mutationId))
          || (row.state === 'active' && (state === 'prepared'
            ? row.generation !== generation || row.sourceEpoch !== source.epoch
            : true)
            && !(state === 'open' && row.generation === generation+1
              && row.mutationId === input.mutationId && row.sourceEpoch === source.epoch))))
        stop('route_unconfirmed');
      entries.push({resource,connection,input,state});
    }
    const summaries = inspected.map(item => ({contextId:item.contextId,state:item.schema.state,
      receiptId:item.managed.receiptId,additions:item.schema.additions,
      columnAdditions:item.schema.columnAdditions}));
    io.write(`Installation : ${config.storageInstallationId} ; plan : ${plan.planDigest}`);
    for (const item of summaries) {
      io.write(`D1 ${item.contextId} : ${item.state} ; reçu ${item.receiptId ?? 'aucun'}`);
      for (const addition of item.additions) io.write(`Ajout D1 ${item.contextId} : ${addition.type} ${addition.name}`);
      for (const addition of item.columnAdditions)
        for (const column of addition.columns)
          io.write(`Colonne D1 ${item.contextId} : ${addition.table}.${column.name} nullable`);
    }
    const details = {planDigest:plan.planDigest, targets:summaries};
    if (inspected.some(item => !item.managed.ok || !['ready','additive'].includes(item.schema.state)))
      result = Object.freeze({...refusal('schema_blocked'),...details});
    else if (mode === 'inspect') result = Object.freeze({ok:true,code:'inspected',effect:'none',...details});
    else if (inspected.every(item => exactSchema(item.managed,plan))
      && entries.every(entry => entry.state === null || entry.state === 'open'))
      result = Object.freeze({ok:true,code:'schema.current',effect:'none',...details});
    else {
      // A route reopened on an earlier invocation cannot coexist with another DDL.
      // Such a mismatch is drift, never an invitation to update an active target.
      if (entries.some(entry => ['source-confirmed','open'].includes(entry.state))
        && inspected.some(item => !exactSchema(item.managed,plan)))
        stop('schema_provenance');
      // A fresh cutover starts from the same composed version on every D1. A resumed
      // journal is the durable proof that mixed old/new receipts belong to this cutover.
      if (entries.some(entry => entry.state === null)
        && (entries.some(entry => entry.state !== null)
          || inspected.some(item => !sameReceiptPlan(item.managed.receipt,primaryReceipt))))
        stop('schema_provenance');
      const approval = await io.readLine('Saisissez exactement l’empreinte du plan pour appliquer ces ajouts : ');
      if (approval !== plan.planDigest) result = Object.freeze({...refusal('schema_approval_mismatch'),...details});
      else {
        let latest;
        try { latest = await engine.loadComposedInstallPlan(config.root); } catch { /* Refuse changed source. */ }
        if (!sameSource(plan,latest)) result = Object.freeze({...refusal('source_changed'),...details});
        else {
          // All routes are denied before the first central DDL. A partial journal can
          // resume only fencing; no DDL begins until the full inventory is fenced.
          for (const entry of entries) if (entry.state === null) {
            writeStarted = true;
            entry.state = await prepareStorageRevocation(primary.db,entry.input);
          }
          for (const entry of entries) if (entry.state === 'prepared') {
            writeStarted = true;
            entry.state = await fenceStorageRoute(primary.db,entry.connection.db,entry.input);
          }
          if (entries.some(entry => entry.state === 'prepared')) stop('route_unconfirmed','unknown');
          if (entries.every(entry => entry.state === 'fenced')) {
            writeStarted = true;
            await claimStorageSourceAttemptBatch(primary.db,entries.map(entry => entry.input));
            for (const entry of entries) entry.state = 'source-attempted';
          }
          if (entries.some(entry => entry.state === 'fenced')) stop('route_unconfirmed','unknown');
          // An unknown DDL acknowledgement is resolved by exact readback. If a D1 is
          // still additive, the central guarded batch is safe to run under the same
          // denied route and explicit approval; no opaque SQL is reconstructed.
          inspected = await inspectAll();
          for (const item of inspected) {
            if (item.schema.state === 'ready' && exactSchema(item.managed,plan)) continue;
            if (item.schema.state !== 'additive') stop('schema_changed','unknown');
            writeStarted = true;
            const applied = await engine.applyCompositionSchema(item.connection.db,plan,
              {expectedPlanDigest:plan.planDigest});
            if (applied?.ok !== true) stop(safeCode(applied?.code),'unknown');
          }
          const allReady = async () => (await inspectAll()).every(item =>
            item.schema.state === 'ready' && exactSchema(item.managed,plan));
          if (!await allReady()) stop('schema_unconfirmed','unknown');
          for (const entry of entries) if (entry.state === 'source-attempted') {
            writeStarted = true;
            entry.state = await confirmStorageSource(primary.db,entry.input,allReady);
          }
          for (const entry of entries) if (entry.state === 'source-confirmed') {
            if (!await allReady()) stop('schema_unconfirmed','unknown');
            writeStarted = true;
            entry.state = await reopenStorageRoute(primary.db,entry.connection.db,
              entry.input,source.epoch);
          }
          if (!await allReady() || entries.some(entry => entry.state !== 'open')
            || !(await Promise.all(entries.map(entry => inspectStorageRouteOpen(
              entry.connection.db,entry.input,source.epoch)))).every(Boolean))
            stop('route_unconfirmed','unknown');
          result = Object.freeze({ok:true,code:'schema.applied',effect:'confirmed',
            planDigest:plan.planDigest,beforeTargets:summaries,
            targets:(await inspectAll()).map(item =>
              ({contextId:item.contextId,receiptId:item.managed.receiptId,state:item.schema.state}))});
        }
      }
    }
  } catch (error) {
    closureUnknown = error?.code === 'local_cleanup_failed';
    const code = ['local_busy','local_path','local_open_failed','local_cleanup_failed',
      'invalid_plan','invalid_inspection','schema_unmanaged','source_unconfirmed',
      'route_changed','route_unconfirmed','schema_provenance','schema_changed',
      'schema_unconfirmed','schema_blocked','source_changed','schema_approval_mismatch',
      'invalid_input'].includes(error?.code) ? error.code : 'schema_failed';
    result = refusal(code, error?.effect === 'unknown' || writeStarted ? 'unknown' : 'none');
  } finally {
    let closed = !closureUnknown;
    for (const connection of opened.reverse()) try { await connection.dispose(); }
    catch { closed = false; result = refusal('local_cleanup_failed',writeStarted?'unknown':'none'); }
    if (lease && closed) try { await lease.release(); }
    catch { result = refusal('local_cleanup_failed',writeStarted?'unknown':'none'); }
  }
  return result;
}

/** Explicit local transport for the centrally compiled additive schema plan. */
export async function runLocalSchema({mode, config = loadLocalConfiguration(), io = createTerminalIO(),
  adapter = openLocalAccessDatabase, engine, lock = acquireLocalRuntimeLock} = {}) {
  if (!['inspect', 'apply'].includes(mode)) return refusal('invalid_mode');
  if (config?.storageInstallationId) return runRoutedSchema({mode,config,io,
    adapter:adapter === openLocalAccessDatabase ? openLocalStoragePair : adapter,engine,lock});
  if (mode === 'apply' && io.interactive === false) return refusal('terminal_required');
  let lease, connection, result = refusal('schema_failed'), writeStarted = false, closureUnknown = false;
  try {
    engine ??= {...await import('../data/install-composition.mjs'), ...await import('../data/apply-schema.mjs')};
    const plan = await engine.loadComposedInstallPlan(config.root);
    if (!hash.test(plan?.planDigest)) return refusal('invalid_plan');
    // The existing install lock purpose excludes the official server and other operators.
    lease = await lock(config, mode === 'apply' ? 'install' : 'inspect');
    connection = await adapter(config);
    const managed = await engine.inspectManagedSchema(connection.db);
    const inspected = await engine.inspectCompositionSchema(connection.db, plan);
    if (!managed || typeof managed.ok !== 'boolean' || !states.has(inspected?.state)
      || !Array.isArray(inspected.additions)||!Array.isArray(inspected.columnAdditions)
      || inspected.additions.some(item => !['table', 'index'].includes(item?.type)
        || typeof item.name !== 'string'))
      throw Object.assign(new Error('Invalid schema inspection.'), {code: 'invalid_inspection'});
    const existing = managed?.ok === true && !!managed.receipt && hash.test(managed.receiptId);
    io.write(`Cible locale : ${config.d1Path}`);
    io.write(`Binding : ${config.bindings.database} ; base : ${config.bindings.databaseId}`);
    io.write(`Plan : ${plan.planDigest} ; composition : ${plan.compositionDigest} ; verrou : ${plan.lockDigest}`);
    io.write(`Reçu courant : ${existing ? managed.receiptId : 'aucun'} ; état : ${inspected.state}`);
    for (const addition of inspected.additions) io.write(`Ajout : ${addition.type} ${addition.name}`);
    for (const addition of inspected.columnAdditions)
      for (const column of addition.columns)
        io.write(`Colonne : ${addition.table}.${column.name} nullable`);
    const details = {state: inspected.state, planDigest: plan.planDigest,
      receiptId: existing ? managed.receiptId : null, additions: inspected.additions,
      columnAdditions: inspected.columnAdditions};
    if (!existing) result = Object.freeze({...refusal(managed.ok === false
      ? safeCode(managed.code) : 'schema_unmanaged'),
      ...details});
    else if (mode === 'inspect') result = Object.freeze({ok: !['blocked', 'unavailable'].includes(inspected.state),
      code: safeCode(inspected.code), effect: 'none', ...details});
    else if (inspected.state === 'ready') result = Object.freeze({ok: true, code: 'schema.current',
      effect: 'none', ...details});
    else if (inspected.state !== 'additive') result = Object.freeze({...refusal(safeCode(inspected.code)), ...details});
    else {
      const approval = await io.readLine('Saisissez exactement l’empreinte du plan pour appliquer ces ajouts : ');
      if (approval !== plan.planDigest) result = Object.freeze({...refusal('schema_approval_mismatch'), ...details});
      else {
        let latest;
        try { latest = await engine.loadComposedInstallPlan(config.root); } catch { /* Refuse changed source. */ }
        if (!sameSource(plan, latest)) result = Object.freeze({...refusal('source_changed'), ...details});
        else {
          writeStarted = true;
          const applied = await engine.applyCompositionSchema(connection.db, latest,
            {expectedPlanDigest: plan.planDigest});
          result = Object.freeze({ok: applied?.ok === true, code: safeCode(applied?.code),
            effect: ['none', 'confirmed', 'unknown'].includes(applied?.effect) ? applied.effect : 'unknown',
            state: states.has(applied?.observedState) ? applied.observedState : 'unavailable',
            planDigest: plan.planDigest,priorReceiptId:details.receiptId,
            receiptId: hash.test(applied?.receiptId) ? applied.receiptId : null,
            additions: inspected.additions,columnAdditions:inspected.columnAdditions});
        }
      }
    }
  } catch (error) {
    closureUnknown = error?.code === 'local_cleanup_failed';
    const code = ['cancelled', 'input_too_long', 'terminal_required', 'local_busy', 'local_path',
      'local_open_failed', 'local_cleanup_failed', 'invalid_inspection'].includes(error?.code)
      ? error.code : 'schema_failed';
    result = refusal(code, writeStarted ? 'unknown' : 'none');
  } finally {
    let closed = !closureUnknown;
    if (connection) try { await connection.dispose(); } catch { closed = false;
      result = refusal('local_cleanup_failed', writeStarted ? 'unknown' : 'none'); }
    if (lease && closed) try { await lease.release(); } catch {
      result = refusal('local_cleanup_failed', writeStarted ? 'unknown' : 'none'); }
  }
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 1 || !['inspect', 'apply'].includes(args[0])) {
    console.error('Usage: npm run schema:inspect | npm run schema:apply. No SQL or credentials are accepted.');
    process.exitCode = 1;
  } else {
    try { const result = await runLocalSchema({mode: args[0]});
      console.log(JSON.stringify(result)); process.exitCode = result.ok ? 0 : 1; }
    catch { console.error('Local schema operation unavailable.'); process.exitCode = 1; }
  }
}
