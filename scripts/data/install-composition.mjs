import {fileURLToPath} from 'node:url';
import {loadCompositionSchema,isCompositionSchemaPlan} from './composition-schema.mjs';
import {inspectCompositionSchema,applyCompositionSchema,inspectManagedSchema,managedSchemaGuard,
  SCHEMA_RECEIPT_OBJECT,SCHEMA_RECEIPT_TABLE} from './apply-schema.mjs';
import {ACCESS_TABLES,normalizeLoginIdentifier} from '../../core/identity/d1-store.ts';
import {normalizeDisplayName} from '../../core/identity/input.ts';
import {createAccountService,provisionBootstrapCapability,validNewPassword} from '../../core/identity/accounts.ts';

const root=fileURLToPath(new URL('../../',import.meta.url));
const quote=name=>`"${name.replaceAll('"','""')}"`;
const result=(ok,code,effect,stage,observedState,principalId)=>Object.freeze({ok,code,effect,stage,observedState,
  ...(principalId?{principalId}:{})});
const state=(state,code,plan)=>Object.freeze({state,code,bootstrap:state==='schema_ready'?'none':state==='bootstrap_expired'?'expired':state==='bootstrap_live'?'live':undefined,
  planDigest:isCompositionSchemaPlan(plan)?plan.planDigest:null,sqlDigest:isCompositionSchemaPlan(plan)?plan.sqlDigest:null});

/** The same centrally compiled plan used by Sites; no module-supplied SQL is executable. */
export async function loadComposedInstallPlan(repository=root){
  const compositionPath=process.env.CREEZIO_COMPOSITION||'configuration/composition.json';
  const lockPath=process.env.CREEZIO_COMPOSITION_LOCK||compositionPath.replace(/\.json$/,'.lock.json');
  return loadCompositionSchema({root:repository,compositionPath,lockPath});
}

function guardedRead(db,plan,receiptId,sql){
  return db.batch([managedSchemaGuard(db,[...plan.objects,SCHEMA_RECEIPT_OBJECT]),
    db.prepare(`SELECT CASE WHEN (SELECT id FROM ${quote(SCHEMA_RECEIPT_TABLE)} ORDER BY sequence DESC LIMIT 1) = ?
      THEN 1 ELSE json('creezio-install-receipt-changed') END AS approved`).bind(receiptId),db.prepare(sql)]);
}

async function inspectReady(db,plan,receiptId){
  const tables=plan.objects.filter(object=>object.type==='table'
    &&![ACCESS_TABLES.bootstrap,ACCESS_TABLES.auth_throttles].includes(object.name));
  const empty=tables.map(object=>`NOT EXISTS (SELECT 1 FROM ${quote(object.name)} LIMIT 1)`).join(' AND ');
  const checks=await guardedRead(db,plan,receiptId,
    `SELECT (SELECT COUNT(*) FROM ${quote(ACCESS_TABLES.bootstrap)}) AS markerCount,
      (SELECT capability_digest FROM ${quote(ACCESS_TABLES.bootstrap)} WHERE id='installation') AS markerDigest,
      (SELECT created_at_ms FROM ${quote(ACCESS_TABLES.bootstrap)} WHERE id='installation') AS createdAtMs,
      (SELECT principal_id FROM ${quote(ACCESS_TABLES.bootstrap)} WHERE id='installation') AS principalId,
      (SELECT claim_nonce FROM ${quote(ACCESS_TABLES.bootstrap)} WHERE id='installation') AS claimNonce,
      (SELECT claimed_at_ms FROM ${quote(ACCESS_TABLES.bootstrap)} WHERE id='installation') AS claimedAtMs,
      (SELECT expires_at_ms FROM ${quote(ACCESS_TABLES.bootstrap)} WHERE id='installation') AS expiresAtMs,
      (SELECT EXISTS(SELECT 1 FROM ${quote(ACCESS_TABLES.principals)} p
        JOIN ${quote(ACCESS_TABLES.human_accounts)} h ON h.principal_id=p.id
        JOIN ${quote(ACCESS_TABLES.password_credentials)} c ON c.principal_id=p.id
        WHERE p.id=(SELECT principal_id FROM ${quote(ACCESS_TABLES.bootstrap)} WHERE id='installation'))) AS accountExists,
      CAST(unixepoch('now') AS INTEGER)*1000 AS nowMs, CASE WHEN ${empty} THEN 1 ELSE 0 END AS empty`);
  if(checks.length!==3||checks.some(item=>item?.success!==true))return state('unavailable','storage_unavailable',plan);
  const row=checks[2].results?.[0];
  if(!row||!Number.isSafeInteger(row.markerCount)||row.markerCount>1)return state('blocked','foreign_data',plan);
  if(row.markerCount===1&&(!/^sha256:[a-f0-9]{64}$/.test(row.markerDigest)
    ||!Number.isSafeInteger(row.createdAtMs)||!Number.isSafeInteger(row.expiresAtMs)
    ||row.expiresAtMs<=row.createdAtMs))return state('blocked','foreign_data',plan);
  if(row.principalId!==null){
    if(row.markerCount!==1||typeof row.principalId!=='string'||!row.principalId
      ||typeof row.claimNonce!=='string'||!row.claimNonce||!Number.isSafeInteger(row.claimedAtMs)
      ||row.accountExists!==1)return state('blocked','foreign_data',plan);
    return state('initialized','already_initialized',plan);
  }
  if(row.empty!==1)return state('blocked','foreign_data',plan);
  if(row.markerCount===0)return state('schema_ready','ready',plan);
  if(row.claimNonce!==null||row.claimedAtMs!==null||!Number.isSafeInteger(row.nowMs))
    return state('blocked','foreign_data',plan);
  return state(row.expiresAtMs>row.nowMs?'bootstrap_live':'bootstrap_expired',
    row.expiresAtMs>row.nowMs?'bootstrap_pending':'ready',plan);
}

/** Read-only inspection. A partial or foreign database is never a fresh installation. */
export async function inspectComposedInstallation(db,plan){
  if(!isCompositionSchemaPlan(plan))return state('blocked','invalid_plan',plan);
  try{
    const schema=await inspectCompositionSchema(db,plan);
    if(schema.state==='ready')return inspectReady(db,plan,schema.receiptId);
    if(schema.state==='additive'){
      const managed=await inspectManagedSchema(db);
      return managed.ok&&!managed.receipt&&managed.objects.length===0
        ?state('fresh','ready',plan):state('blocked','schema_incomplete_or_existing',plan);
    }
    return state(schema.state,schema.code,plan);
  }catch{return state('unavailable','storage_unavailable',plan);}
}

function guardedDatabase(db,plan,receiptId){
  const statements=new WeakMap();
  const rows=plan.objects.filter(object=>object.type==='table'
    &&![ACCESS_TABLES.bootstrap,ACCESS_TABLES.auth_throttles].includes(object.name));
  const emptyGuard=()=>db.prepare(`SELECT CASE WHEN ${rows.map(object=>`NOT EXISTS (SELECT 1 FROM ${quote(object.name)} LIMIT 1)`).join(' AND ')}
    THEN 1 ELSE json('creezio-install-data-present') END AS approved`);
  const receiptGuard=()=>db.prepare(`SELECT CASE WHEN (SELECT id FROM ${quote(SCHEMA_RECEIPT_TABLE)} ORDER BY sequence DESC LIMIT 1) = ?
    THEN 1 ELSE json('creezio-install-receipt-changed') END AS approved`).bind(receiptId);
  const before=()=>[managedSchemaGuard(db,[...plan.objects,SCHEMA_RECEIPT_OBJECT]),receiptGuard(),emptyGuard()];
  const after=()=>managedSchemaGuard(db,[...plan.objects,SCHEMA_RECEIPT_OBJECT]);
  function wrap(raw){
    const wrapped={bind:(...args)=>wrap(raw.bind(...args)),
      async all(){const values=await db.batch([...before(),raw,after()]);return values[3];},
      async run(){const values=await db.batch([...before(),raw,after()]);return values[3];},
      async first(column){const values=await db.batch([...before(),raw,after()]);const row=values[3]?.results?.[0];return row?(column?row[column]:row):null;}};
    statements.set(wrapped,raw);return wrapped;
  }
  return Object.freeze({prepare:sql=>wrap(db.prepare(sql)),
    async batch(inputs){const raw=inputs.map(input=>{const item=statements.get(input);if(!item)throw new Error('Foreign installer statement');return item;});
      const values=await db.batch([...before(),...raw,after()]);return values.slice(3,-1);}});
}

/** Explicit account installation after an approved full-schema batch. Unknown effects are inspected,
 * never replayed. A consumed marker permanently closes the installer. */
export async function installComposed(db,plan,input){
  const credentials=input?.credentials,loginIdentifier=normalizeLoginIdentifier(credentials?.loginIdentifier);
  const displayName=normalizeDisplayName(credentials?.displayName);
  if(!isCompositionSchemaPlan(plan)||input?.expectedPlanDigest!==plan.planDigest
    ||typeof input?.createSchema!=='boolean'||!loginIdentifier||!displayName||!validNewPassword(credentials?.password))
    return result(false,'invalid_input','none','preflight','unknown');
  let before=await inspectComposedInstallation(db,plan);
  if(before.state==='fresh'){
    if(!input.createSchema)return result(false,'schema_required','none','preflight','fresh');
    const created=await applyCompositionSchema(db,plan,{expectedPlanDigest:plan.planDigest});
    if(!created.ok)return result(false,created.code,created.effect,'schema',created.observedState);
    before=await inspectComposedInstallation(db,plan);
    if(before.state!=='schema_ready')return result(false,'outcome_unknown','unknown','schema',before.state);
  }
  if(!['schema_ready','bootstrap_expired'].includes(before.state))
    return result(false,before.code,'none','preflight',before.state);
  const schema=await inspectCompositionSchema(db,plan);
  if(schema.state!=='ready')return result(false,'schema_changed','none','preflight',schema.state);
  try{
    const guarded=guardedDatabase(db,plan,schema.receiptId);
    const capability=await provisionBootstrapCapability(guarded);
    if(!capability){const after=await inspectComposedInstallation(db,plan);
      return result(false,after.state==='bootstrap_live'?'bootstrap_pending':'bootstrap_unavailable','none','bootstrap',after.state);}
    const account=await createAccountService(guarded).bootstrap({token:capability.token,loginIdentifier,
      displayName,password:credentials.password});
    if(!account.ok){const after=await inspectComposedInstallation(db,plan);
      return result(false,account.code,'confirmed','bootstrap',after.state);}
    return result(true,'installed','confirmed','complete','initialized',account.principalId);
  }catch{
    const after=await inspectComposedInstallation(db,plan);
    return result(false,'outcome_unknown','unknown','bootstrap',after.state);
  }
}
