import '../local-environment.mjs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadLocalConfiguration} from './config.mjs';
import {acquireLocalRuntimeLock} from './lock.mjs';
import {openLocalAccessDatabase} from './database.mjs';
import {createTerminalIO} from './tty.mjs';

const hash = /^sha256-[a-f0-9]{64}$/;
const states = new Set(['ready', 'additive', 'blocked', 'unavailable']);
const refusal = (code, effect = 'none') => Object.freeze({ok: false, code, effect});
const safeCode = value => typeof value === 'string' && /^[a-z][a-z0-9._-]{0,63}$/.test(value)
  ? value : 'schema_failed';
const sameSource = (left, right) => ['planDigest', 'modelDigest', 'sqlDigest',
  'compositionDigest', 'lockDigest'].every(key => left?.[key] === right?.[key]);

/** Explicit local transport for the centrally compiled additive schema plan. */
export async function runLocalSchema({mode, config = loadLocalConfiguration(), io = createTerminalIO(),
  adapter = openLocalAccessDatabase, engine, lock = acquireLocalRuntimeLock} = {}) {
  if (!['inspect', 'apply'].includes(mode)) return refusal('invalid_mode');
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
      || !Array.isArray(inspected.additions)
      || inspected.additions.some(item => !['table', 'index'].includes(item?.type)
        || typeof item.name !== 'string'))
      throw Object.assign(new Error('Invalid schema inspection.'), {code: 'invalid_inspection'});
    const existing = managed?.ok === true && !!managed.receipt && hash.test(managed.receiptId);
    io.write(`Cible locale : ${config.d1Path}`);
    io.write(`Binding : ${config.bindings.database} ; base : ${config.bindings.databaseId}`);
    io.write(`Plan : ${plan.planDigest} ; composition : ${plan.compositionDigest} ; verrou : ${plan.lockDigest}`);
    io.write(`Reçu courant : ${existing ? managed.receiptId : 'aucun'} ; état : ${inspected.state}`);
    for (const addition of inspected.additions) io.write(`Ajout : ${addition.type} ${addition.name}`);
    const details = {state: inspected.state, planDigest: plan.planDigest,
      receiptId: existing ? managed.receiptId : null, additions: inspected.additions};
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
            planDigest: plan.planDigest, receiptId: hash.test(applied?.receiptId) ? applied.receiptId : null,
            additions: inspected.additions});
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
