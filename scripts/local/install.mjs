import '../local-environment.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLocalConfiguration } from './config.mjs';
import { acquireLocalRuntimeLock } from './lock.mjs';
import { openLocalAccessDatabase } from './database.mjs';
import { createTerminalIO } from './tty.mjs';
import { validNewPassword } from '../../core/identity/accounts.ts';
import { normalizeLoginIdentifier } from '../../core/identity/d1-store.ts';
import { normalizeDisplayName } from '../../core/identity/input.ts';

const states = new Set(['fresh', 'schema_ready', 'bootstrap_live', 'bootstrap_expired', 'initialized', 'blocked', 'unavailable']);
const safeCode = value => typeof value === 'string' && /^[a-z][a-z0-9_]{0,63}(?![\s\S])/.test(value) ? value : 'installation_failed';
const refusal = (code, effect = 'none') => Object.freeze({ ok: false, code, effect });

/** IO/dependencies can be supplied by tests, never by command-line module paths. */
export async function runLocalInstallation({ mode, config = loadLocalConfiguration(), io = createTerminalIO(),
  adapter = openLocalAccessDatabase, engine, lock = acquireLocalRuntimeLock } = {}) {
  if (!['inspect', 'install'].includes(mode)) return refusal('invalid_mode');
  if (mode === 'install' && io.interactive === false) return refusal('terminal_required');
  let lease, connection, result = refusal('installation_failed'), writeStarted = false, closureUnknown = false, password, confirmation;
  try {
    engine ??= await import('../data/install-composition.mjs');
    const plan = await engine.loadComposedInstallPlan(config.root);
    if (typeof plan?.planDigest !== 'string' || !/^sha256-[a-f0-9]{64}(?![\s\S])/.test(plan.planDigest)) throw Object.assign(new Error('Invalid installation plan.'), { code: 'invalid_plan' });
    lease = await lock(config, mode);
    connection = await adapter(config);
    const inspection = await engine.inspectComposedInstallation(connection.db, plan);
    if (!states.has(inspection?.state)) throw Object.assign(new Error('Invalid inspection result.'), { code: 'invalid_inspection' });
    io.write(`Cible locale : ${config.d1Path}`);
    io.write(`Binding : ${config.bindings.database} ; base : ${config.bindings.databaseId}`);
    io.write(`Schéma composé central ; empreinte du plan : ${plan.planDigest}`);
    io.write(`État : ${inspection.state}`);
    if (mode === 'inspect') {
      result = Object.freeze({ ok: !['blocked', 'unavailable'].includes(inspection.state), code: 'inspected', state: inspection.state, effect: 'none' });
    } else if (inspection.state === 'initialized') result = refusal('already_initialized');
    else if (inspection.state === 'bootstrap_live') result = refusal('bootstrap_pending');
    else if (!(inspection.state === 'fresh'
      || inspection.state === 'schema_ready' && inspection.bootstrap === 'none'
      || inspection.state === 'bootstrap_expired' && inspection.bootstrap === 'expired')) result = refusal('installation_blocked');
    else {
      const loginIdentifier = normalizeLoginIdentifier(await io.readLine('Identifiant du premier administrateur : '));
      const displayName = normalizeDisplayName(await io.readLine('Nom affiché : '));
      password = await io.readSecret('Mot de passe (au moins 15 caractères, saisie masquée) : ');
      confirmation = await io.readSecret('Confirmez le mot de passe : ');
      if (!loginIdentifier || !displayName || !validNewPassword(password) || password !== confirmation) result = refusal('invalid_input');
      else {
        const createSchema = inspection.state === 'fresh';
        io.write(`Action : ${createSchema ? 'créer le schéma central puis ' : ''}créer le premier administrateur ${loginIdentifier}.`);
        io.write(`Destination : ${config.d1Path} ; plan : ${plan.planDigest}`);
        if (!await io.confirm('Tapez INSTALLER pour confirmer cette destination et cette action : ')) result = refusal('cancelled');
        else {
          let sourceUnchanged = false;
          try {
            const latest = await engine.loadComposedInstallPlan(config.root);
            sourceUnchanged = ['planDigest', 'modelDigest', 'sqlDigest', 'compositionDigest', 'lockDigest'].every(key => latest?.[key] === plan[key]);
          } catch { /* A changed or unreadable source invalidates the operator's concrete approval. */ }
          if (!sourceUnchanged) result = refusal('source_changed');
          else {
            writeStarted = true;
            const installed = await engine.installComposed(connection.db, plan, {
              credentials: { loginIdentifier, displayName, password }, expectedPlanDigest: plan.planDigest, createSchema });
            result = Object.freeze({ ok: installed?.ok === true, code: safeCode(installed?.code),
              effect: ['none', 'confirmed', 'unknown'].includes(installed?.effect) ? installed.effect : 'unknown',
              ...(typeof installed?.stage === 'string' ? { stage: safeCode(installed.stage) } : {}),
              ...(states.has(installed?.observedState) || installed?.observedState === 'unknown' ? { observedState: installed.observedState } : {}) });
          }
        }
      }
    }
  } catch (error) {
    closureUnknown = error?.code === 'local_cleanup_failed';
    const code = ['cancelled', 'input_too_long', 'terminal_required', 'local_busy', 'local_path', 'invalid_plan', 'invalid_inspection', 'local_open_failed', 'local_cleanup_failed'].includes(error?.code) ? error.code : 'installation_failed';
    result = refusal(code, writeStarted ? 'unknown' : 'none');
  } finally {
    // JavaScript strings cannot be guaranteed erased from memory; never persist or print them.
    password = undefined; confirmation = undefined;
    let closed = !closureUnknown;
    if (connection) try { await connection.dispose(); } catch { closed = false; result = refusal('local_cleanup_failed', writeStarted ? 'unknown' : 'none'); }
    // A runtime whose closure is uncertain keeps its lock. No unsafe automatic stale-lock recovery.
    if (lease && closed) try { await lease.release(); } catch { result = refusal('local_cleanup_failed', writeStarted ? 'unknown' : 'none'); }
  }
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 1 || !['inspect', 'install'].includes(args[0])) {
    console.error('Usage: npm run access:inspect | npm run access:install. No credential arguments are accepted.');
    process.exitCode = 1;
  } else {
    try {
      const result = await runLocalInstallation({ mode: args[0] });
      console.log(JSON.stringify(result)); process.exitCode = result.ok ? 0 : 1;
    } catch { console.error('Local installation unavailable. No secret or database diagnostic is printed.'); process.exitCode = 1; }
  }
}
