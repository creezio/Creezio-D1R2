import '../local-environment.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLocalConfiguration } from './config.mjs';
import { acquireLocalRuntimeLock } from './lock.mjs';
import { openLocalAccessDatabase } from './database.mjs';
import {openLocalStoragePair} from './database.mjs';
import { createTerminalIO } from './tty.mjs';
import {createHash} from 'node:crypto';
import { validNewPassword } from '../../core/identity/accounts.ts';
import { normalizeLoginIdentifier } from '../../core/identity/d1-store.ts';
import { normalizeDisplayName } from '../../core/identity/input.ts';
import {ACCESS_TABLES} from '../../core/identity/d1-store.ts';
import {STORAGE_AUTHORITY_TABLES} from '../../core/storage-authority/models.ts';
import {initializeStorageRouteDeny,inspectStorageRevocation,markStorageSourceAttempted,
  confirmStorageSource,reopenStorageRoute,inspectStorageRouteOpen}
  from '../../core/storage-authority/coordinator.ts';

const states = new Set(['fresh', 'schema_ready', 'bootstrap_live', 'bootstrap_expired', 'initialized', 'blocked', 'unavailable']);
const safeCode = value => typeof value === 'string' && /^[a-z][a-z0-9_]{0,63}(?![\s\S])/.test(value) ? value : 'installation_failed';
const refusal = (code, effect = 'none') => Object.freeze({ ok: false, code, effect });
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const routeTable=`"${STORAGE_AUTHORITY_TABLES.storage_routes}"`;
const mutationTable=`"${STORAGE_AUTHORITY_TABLES.storage_mutations}"`;
const authState=`"${ACCESS_TABLES.authorization_state}"`;
const exactSchema=(managed,plan)=>managed?.ok===true&&managed.receipt
  &&managed.receipt.planDigest===plan.planDigest
  &&managed.receipt.compositionDigest===plan.compositionDigest
  &&managed.receipt.lockDigest===plan.lockDigest
  &&managed.receipt.modelDigest===plan.modelDigest
  &&managed.receipt.sqlDigest===plan.sqlDigest
  &&/^sha256-[a-f0-9]{64}$/.test(managed.receiptId);
const routeInput=(config,plan,resource)=>{
  const commandDigest=`sha256-${hash(['local.storage.install',config.storageInstallationId,
    plan.planDigest,resource.contextId,resource.slot,resource.databaseId,resource.bucketName])}`;
  return {installationId:config.storageInstallationId,contextId:resource.contextId,
    slot:resource.slot,mutationId:`local-install:${hash([commandDigest,resource.contextId,
      resource.slot,resource.databaseId,resource.bucketName]).slice(0,48)}`,
    commandDigest,expectedGeneration:1};
};
// A schema cutover keeps the installation but advances the target route's mutation.
// Prove the complete local journal lineage instead of recomputing an old plan digest.
export async function installedRouteInput(source,config,plan,resource,row){
  if(!row||!Number.isSafeInteger(row.generation)||row.generation<2
    ||!['deny','active'].includes(row.state))return null;
  const lastGeneration=row.generation-1;
  let last,lastStructural,generation=0,cursorGeneration=0,cursorId='';
  while(true){
    const listed=await source.prepare(`SELECT id,installation_id AS installationId,
      context_id AS contextId,generation,command_digest AS commandDigest,state FROM ${mutationTable}
      WHERE installation_id=? AND context_id=? AND generation<=?
        AND (generation>? OR (generation=? AND id>?))
      ORDER BY generation,id LIMIT 64`)
      .bind(config.storageInstallationId,resource.contextId,lastGeneration,
        cursorGeneration,cursorGeneration,cursorId).all();
    if(!Array.isArray(listed.results)||listed.results.length>64)return null;
    if(listed.results.length===0)break;
    for(const item of listed.results){
      if(item.generation!==generation+1)return null;
      const journal=item;
      const prefix=generation===0?'local-install:'
        :journal.id.startsWith('local-schema:')?'local-schema:'
          :journal.id.startsWith('authority:')?'authority:'
            :journal.id.startsWith('logout:')?'logout:':null;
      const nativeMutation=prefix==='authority:'||prefix==='logout:';
      const identity=nativeMutation
        ?[journal.commandDigest,resource.contextId,resource.slot]
        :[journal.commandDigest,resource.contextId,resource.slot,
          resource.databaseId,resource.bucketName];
      if(journal?.installationId!==config.storageInstallationId
        ||journal.contextId!==resource.contextId||journal.generation!==item.generation
        ||!/^sha256-[a-f0-9]{64}$/.test(journal.commandDigest)
        ||!prefix||journal.id!==`${prefix}${hash(identity).slice(0,48)}`
        ||(nativeMutation&&journal.state!=='open')
        ||(generation<lastGeneration-1&&journal.state!=='open'))return null;
      if(!nativeMutation)lastStructural=journal;
      last=journal;generation++;cursorGeneration=item.generation;cursorId=item.id;
    }
  }
  if(generation!==lastGeneration)return null;
  if(last?.id!==row.mutationId)return null;
  const expectedDigest=lastStructural?.generation===1?routeInput(config,plan,resource).commandDigest
    :`sha256-${hash(['local.schema.apply',config.storageInstallationId,plan.planDigest,
      config.storageResources.map(item=>[item.contextId,item.slot,item.status,
        item.databaseId,item.bucketName])])}`;
  if(lastStructural?.commandDigest!==expectedDigest)return null;
  return {installationId:config.storageInstallationId,contextId:resource.contextId,
    slot:resource.slot,mutationId:last.id,commandDigest:last.commandDigest,
    expectedGeneration:last.generation};
}

/** Routed installation uses the same central plan, but bootstraps accounts only in DB. */
async function runRoutedInstallation({mode,config,io,adapter,engine,lock}){
  if(!Array.isArray(config.storageResources)||!config.storageResources.some(item=>item.status==='active'))
    return refusal('invalid_storage_resources');
  let lease,result=refusal('installation_failed'),writeStarted=false,closureUnknown=false;
  const opened=[];
  let password,confirmation;
  const stop=(code,effect=writeStarted?'unknown':'none')=>{
    throw Object.assign(new Error(`Local routed installation ${code}.`),{code,effect});
  };
  try{
    engine ??= {...await import('../data/install-composition.mjs'),
      ...await import('../data/apply-schema.mjs')};
    const plan=await engine.loadComposedInstallPlan(config.root);
    if(!/^sha256-[a-f0-9]{64}$/.test(plan?.planDigest))return refusal('invalid_plan');
    lease=await lock(config,mode);
    const connect=async contextId=>{
      const connection=await adapter(config,contextId);opened.push(connection);return connection;
    };
    const primary=await connect('application');
    const active=config.storageResources.filter(item=>item.status==='active');
    const targets=[];
    for(const resource of active)targets.push({resource,connection:await connect(resource.contextId)});
    const primaryInspection=await engine.inspectComposedInstallation(primary.db,plan);
    if(!states.has(primaryInspection?.state))throw Object.assign(new Error('Invalid inspection.'),{code:'invalid_inspection'});
    io.write(`Cible primaire : ${config.bindings.databaseId} ; installation : ${config.storageInstallationId}`);
    io.write(`Plan central : ${plan.planDigest} ; ${active.length} paire(s) actives.`);
    const inspections=[];
    const installedInputs=new Map();
    let schemaCutoverPending=false;
    const primaryManaged=primaryInspection.state==='initialized'
      ?await engine.inspectManagedSchema(primary.db):null;
    const sourceProven=primaryInspection.state==='initialized'&&exactSchema(primaryManaged,plan);
    const sourceEpoch=sourceProven?await primary.db.prepare(`SELECT epoch FROM ${authState}
      WHERE id='application' LIMIT 2`).first():null;
    for(const {resource,connection} of targets){
      const schema=await engine.inspectCompositionSchema(connection.db,plan);
      if(!['ready','additive','blocked','unavailable'].includes(schema?.state))
        throw Object.assign(new Error('Invalid schema inspection.'),{code:'invalid_inspection'});
      const installation=await engine.inspectComposedInstallation(connection.db,plan);
      let provenance=false;
      if(sourceProven&&Number.isSafeInteger(sourceEpoch?.epoch)&&sourceEpoch.epoch>=1
        &&schema.state==='ready'&&exactSchema(await engine.inspectManagedSchema(connection.db),plan)){
        try{
          const row=await connection.db.prepare(`SELECT state,mutation_id AS mutationId,
            generation,source_epoch AS sourceEpoch FROM ${routeTable}
            WHERE id=? AND installation_id=? AND slot=? LIMIT 2`)
            .bind(resource.contextId,config.storageInstallationId,resource.slot).first();
          const input=await installedRouteInput(primary.db,config,plan,resource,row);
          const journal=input?await inspectStorageRevocation(primary.db,input):null;
          provenance=!!input&&row.generation===input.expectedGeneration+1
            &&row.sourceEpoch===sourceEpoch.epoch
            &&(row.state==='deny'&&['fenced','source-attempted','source-confirmed'].includes(journal)
              ||row.state==='active'&&['source-confirmed','open'].includes(journal));
          if(provenance){
            installedInputs.set(resource.contextId,input);
            if(row.state==='deny'&&input.expectedGeneration>1)schemaCutoverPending=true;
          }
        }catch{/* A missing or foreign route never authorizes adoption. */}
      }
      let virgin=false;
      if(!provenance&&['fresh','schema_ready'].includes(installation?.state)){
        try{
          const listed=await connection.bucket?.list({limit:1});
          virgin=Array.isArray(listed?.objects)&&listed.objects.length===0
            &&listed.truncated===false;
        }catch{/* Unavailable inventory is not an empty bucket. */}
      }
      inspections.push({contextId:resource.contextId,slot:resource.slot,state:schema.state,
        additions:schema.additions,provenance:provenance?'installed':virgin?'empty':'unproven'});
      io.write(`Paire ${resource.slot} (${resource.contextId}) : ${resource.databaseId} ; ${schema.state}.`);
    }
    if(mode==='inspect'){
      result=Object.freeze({ok:!['blocked','unavailable'].includes(primaryInspection.state)
        &&!schemaCutoverPending
        &&inspections.every(item=>!['blocked','unavailable'].includes(item.state)
          &&item.provenance!=='unproven'),
        code:'inspected',effect:'none',state:primaryInspection.state,targets:inspections});
    }else if(inspections.some(item=>item.provenance==='unproven'))
      result=refusal('target_unproven');
    else if(schemaCutoverPending)result=refusal('schema_cutover_pending');
    else if(!['fresh','schema_ready','bootstrap_expired','initialized'].includes(primaryInspection.state)
      ||inspections.some(item=>!['ready','additive'].includes(item.state)))
      result=refusal('installation_blocked');
    else{
      let credentials;
      if(primaryInspection.state!=='initialized'){
        const loginIdentifier=normalizeLoginIdentifier(await io.readLine('Identifiant du premier administrateur : '));
        const displayName=normalizeDisplayName(await io.readLine('Nom affiché : '));
        password=await io.readSecret('Mot de passe (au moins 15 caractères, saisie masquée) : ');
        confirmation=await io.readSecret('Confirmez le mot de passe : ');
        if(!loginIdentifier||!displayName||!validNewPassword(password)||password!==confirmation)
          stop('invalid_input','none');
        credentials={loginIdentifier,displayName,password};
      }
      io.write('Action : schéma central sur chaque D1, compte principal unique et routes initialement fermées.');
      if(!await io.confirm('Tapez INSTALLER pour confirmer toutes ces destinations : '))
        result=refusal('cancelled');
      else{
        const latest=await engine.loadComposedInstallPlan(config.root);
        if(!['planDigest','modelDigest','sqlDigest','compositionDigest','lockDigest']
          .every(field=>latest?.[field]===plan[field]))result=refusal('source_changed');
        else{
          if(primaryInspection.state!=='initialized'){
            writeStarted=true;
            const installed=await engine.installComposed(primary.db,plan,{credentials,
              expectedPlanDigest:plan.planDigest,createSchema:primaryInspection.state==='fresh'});
            if(installed?.ok!==true)stop(safeCode(installed?.code),
              ['none','confirmed','unknown'].includes(installed?.effect)?installed.effect:'unknown');
          }
          if((await engine.inspectComposedInstallation(primary.db,plan)).state!=='initialized'
            ||!exactSchema(await engine.inspectManagedSchema(primary.db),plan))
            stop('source_unconfirmed');
          for(const {connection} of targets){
            const inspection=await engine.inspectCompositionSchema(connection.db,plan);
            if(inspection.state==='additive'){
              writeStarted=true;
              const applied=await engine.applyCompositionSchema(connection.db,plan,
                {expectedPlanDigest:plan.planDigest});
              if(applied?.ok!==true)stop(safeCode(applied?.code),
                ['none','confirmed','unknown'].includes(applied?.effect)?applied.effect:'unknown');
            }else if(inspection.state!=='ready')stop('schema_changed');
          }
          const receipts=[];
          for(const {resource,connection} of targets){
            const managed=await engine.inspectManagedSchema(connection.db);
            if(!exactSchema(managed,plan)
              ||(await engine.inspectCompositionSchema(connection.db,plan)).state!=='ready')
              stop('schema_unconfirmed');
            receipts.push({contextId:resource.contextId,receiptId:managed.receiptId});
          }
          const source=await primary.db.prepare(`SELECT epoch FROM ${authState}
            WHERE id='application' LIMIT 2`).first();
          if(!Number.isSafeInteger(source?.epoch)||source.epoch<1)
            stop('source_unconfirmed');
          for(const {resource,connection} of targets){
            const input=installedInputs.get(resource.contextId)??routeInput(config,plan,resource);
            const state=await inspectStorageRevocation(primary.db,input);
            if(state==='open'){
              if(!await inspectStorageRouteOpen(connection.db,input,source.epoch))
                stop('route_changed','unknown');
              continue;
            }
            if(state!=='source-confirmed'){
              writeStarted=true;
              await initializeStorageRouteDeny(primary.db,connection.db,input,source.epoch);
            }
          }
          const allReady=async()=>{
            if((await engine.inspectComposedInstallation(primary.db,plan)).state!=='initialized'
              ||!exactSchema(await engine.inspectManagedSchema(primary.db),plan))return false;
            for(const {resource,connection} of targets){
              if(!exactSchema(await engine.inspectManagedSchema(connection.db),plan))return false;
              const input=installedInputs.get(resource.contextId)??routeInput(config,plan,resource);
              const row=await connection.db.prepare(`SELECT state,mutation_id AS mutationId,generation
                FROM ${routeTable} WHERE id=? AND installation_id=? AND slot=? LIMIT 2`)
                .bind(resource.contextId,input.installationId,resource.slot).first();
              const state=await inspectStorageRevocation(primary.db,input);
              if(row?.mutationId!==input.mutationId||row.generation!==input.expectedGeneration+1
                ||!['deny','active'].includes(row.state)
                ||!['fenced','source-attempted','source-confirmed','open'].includes(state))return false;
            }
            return true;
          };
          if(!await allReady())stop('route_unconfirmed','unknown');
          for(const {resource} of targets){
            const input=installedInputs.get(resource.contextId)??routeInput(config,plan,resource);
            const state=await inspectStorageRevocation(primary.db,input);
            if(state==='fenced')await markStorageSourceAttempted(primary.db,input);
            if(await inspectStorageRevocation(primary.db,input)==='source-attempted')
              await confirmStorageSource(primary.db,input,allReady);
          }
          for(const {resource,connection} of targets){
            const input=installedInputs.get(resource.contextId)??routeInput(config,plan,resource);
            await reopenStorageRoute(primary.db,connection.db,input,source.epoch);
            if(!await inspectStorageRouteOpen(connection.db,input,source.epoch))
              stop('route_unconfirmed','unknown');
          }
          result=Object.freeze({ok:true,code:'installed',effect:'confirmed',
            state:'initialized',receipts});
        }
      }
    }
  }catch(error){
    closureUnknown=error?.code==='local_cleanup_failed';
    result=refusal(['local_busy','local_path','local_open_failed','local_cleanup_failed',
      'invalid_plan','invalid_inspection','invalid_input','source_changed',
      'source_unconfirmed','schema_changed','schema_unconfirmed','route_changed',
      'route_unconfirmed'].includes(error?.code)?error.code:'installation_failed',
    ['none','confirmed','unknown'].includes(error?.effect)?error.effect:writeStarted?'unknown':'none');
  }finally{
    password=undefined;confirmation=undefined;
    let closed=!closureUnknown;
    for(const connection of opened.reverse())try{await connection.dispose();}
    catch{closed=false;result=refusal('local_cleanup_failed',writeStarted?'unknown':'none');}
    if(lease&&closed)try{await lease.release();}
    catch{result=refusal('local_cleanup_failed',writeStarted?'unknown':'none');}
  }
  return result;
}

/** IO/dependencies can be supplied by tests, never by command-line module paths. */
export async function runLocalInstallation({ mode, config = loadLocalConfiguration(), io = createTerminalIO(),
  adapter = openLocalAccessDatabase, engine, lock = acquireLocalRuntimeLock } = {}) {
  if (!['inspect', 'install'].includes(mode)) return refusal('invalid_mode');
  if (mode === 'install' && io.interactive === false) return refusal('terminal_required');
  if(config?.storageInstallationId)return runRoutedInstallation({mode,config,io,
    adapter:adapter===openLocalAccessDatabase?openLocalStoragePair:adapter,engine,lock});
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
