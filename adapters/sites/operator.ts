import {createAccountService, provisionBootstrapCapability, validNewPassword} from '../../core/identity/accounts.ts';
import {ACCESS_TABLES, normalizeLoginIdentifier} from '../../core/identity/d1-store.ts';
import {normalizeDisplayName} from '../../core/identity/input.ts';

export interface InstallerSchemaObject {
  readonly type: 'table' | 'index'; readonly name: string; readonly table: string; readonly sql: string | null;
}
export interface HostedInstallPlan {
  readonly schemaVersion: 1; readonly digest: string; readonly applicationId: string;
  readonly objects: readonly InstallerSchemaObject[];
  /** Exact provider-owned definitions observed and qualified for the chosen host. */
  readonly providerObjects: readonly InstallerSchemaObject[];
}
type OperatorEnvironment = {DB: D1Database; CREEZIO_INSTALL_TOKEN: string; CREEZIO_INSTALL_EXPIRES_AT: string;
  CREEZIO_APP_ORIGIN: string};
const encoder = new TextEncoder();
const plain = (v: unknown): v is Record<string,unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
  && [Object.prototype,null].includes(Object.getPrototypeOf(v));
const normalized = (sql: string) => sql.trim().replace(/;$/, '').trimEnd();
const reply = (status: number, body: unknown) => Response.json(body,{status,
  headers:{'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'}});

function capturePlan(input: HostedInstallPlan): HostedInstallPlan {
  if (!plain(input) || input.schemaVersion !== 1 || !/^sha256-[a-f0-9]{64}$/.test(input.digest)
    || !/^[a-z][a-z0-9._-]{0,127}$/.test(input.applicationId) || !Array.isArray(input.objects)
    || !Array.isArray(input.providerObjects) || input.objects.length < 1 || input.objects.length > 1024
    || input.providerObjects.length > 16 || encoder.encode(JSON.stringify(input)).byteLength > 1_048_576)
    throw new Error('Invalid operator installation plan.');
  const all = [...input.objects,...input.providerObjects];
  for (const o of all) if (!plain(o) || typeof o.type !== 'string' || !['table','index'].includes(o.type)
    || typeof o.name !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,511}$/.test(o.name)
    || typeof o.table !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,511}$/.test(o.table)
    || !(typeof o.sql === 'string' && /^CREATE (?:TABLE|(?:UNIQUE )?INDEX) /i.test(o.sql) && o.sql.length <= 100_000
      || o.sql === null && o.type === 'index' && o.name.startsWith('sqlite_autoindex_') && input.providerObjects.includes(o as unknown as InstallerSchemaObject)))
    throw new Error('Invalid operator schema object.');
  if (new Set(all.map(o=>o.name)).size !== all.length
    || !Object.values(ACCESS_TABLES).every(name=>input.objects.some(o=>o.type==='table'&&o.name===name)))
    throw new Error('Missing or duplicate native schema.');
  const capture = (o: InstallerSchemaObject) => Object.freeze({...o,sql:o.sql === null ? null : normalized(o.sql)});
  return Object.freeze({...input,objects:Object.freeze(input.objects.map(capture)),
    providerObjects:Object.freeze(input.providerObjects.map(capture))});
}

function schemaGuard(db: D1Database, plan: HostedInstallPlan): D1PreparedStatement {
  const expected = [...plan.objects,...plan.providerObjects];
  return db.prepare(`WITH expected AS (
    SELECT json_extract(value,'$.type') AS type,json_extract(value,'$.name') AS name,
      json_extract(value,'$.table') AS tbl_name,json_extract(value,'$.sql') AS sql FROM json_each(?)
  ), actual AS (SELECT type,name,tbl_name,sql FROM sqlite_schema)
  SELECT CASE WHEN (SELECT COUNT(*) FROM actual)=(SELECT COUNT(*) FROM expected)
    AND NOT EXISTS (SELECT 1 FROM expected e LEFT JOIN actual a ON a.name=e.name
      WHERE a.type IS NOT e.type OR a.tbl_name IS NOT e.tbl_name OR a.sql IS NOT e.sql)
    THEN 1 ELSE json('creezio-operator-schema-mismatch') END AS approved`).bind(JSON.stringify(expected));
}

/** Wrap only this explicit operator's native service calls. No SQL is received over HTTP. */
function guardedDatabase(db: D1Database, plan: HostedInstallPlan): D1Database {
  const statements = new WeakMap<object,D1PreparedStatement>();
  function wrap(raw: D1PreparedStatement): D1PreparedStatement {
    const value = {
      bind: (...args: unknown[]) => wrap(raw.bind(...args)),
      async all() {const result=await db.batch([schemaGuard(db,plan),raw]); return result[1];},
      async run() {const result=await db.batch([schemaGuard(db,plan),raw]); return result[1];},
      async first(column?: string) {
        const result=await db.batch<Record<string,unknown>>([schemaGuard(db,plan),raw]); const row=result[1]?.results[0];
        return row ? column ? row[column] : row : null;
      },
    } as unknown as D1PreparedStatement;
    statements.set(value,raw); return value;
  }
  return {prepare:(sql:string)=>wrap(db.prepare(sql)),async batch(inputs: D1PreparedStatement[]) {
    const raw=inputs.map(input=>{const value=statements.get(input);if(!value)throw new Error('Foreign operator statement.');return value;});
    return (await db.batch([schemaGuard(db,plan),...raw])).slice(1);
  }} as D1Database;
}

async function sameToken(supplied: string, expected: string): Promise<boolean> {
  const [left,right]=await Promise.all([supplied,expected].map(value=>crypto.subtle.digest('SHA-256',encoder.encode(value))));
  const a=new Uint8Array(left),b=new Uint8Array(right);let difference=0;
  for(let i=0;i<a.length;i++)difference|=a[i]!^b[i]!;
  return difference===0;
}
async function readInput(request: Request): Promise<Record<string,unknown>> {
  if (request.headers.get('content-type')?.split(';')[0]?.trim() !== 'application/json' || !request.body) throw 0;
  const reader=request.body.getReader(),chunks:Uint8Array[]=[];let size=0,timedOut=false;
  const timer=setTimeout(()=>{timedOut=true;void reader.cancel().catch(()=>{});},10_000);
  try {
    while(true){const {done,value}=await reader.read();if(done)break;if((size+=value.byteLength)>8192)throw 0;chunks.push(value);}
    if(timedOut)throw 0;
    const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
    const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));if(!plain(value))throw 0;return value;
  } finally {clearTimeout(timer);await reader.cancel().catch(()=>{});reader.releaseLock();}
}

/** Separate, short-lived deployment artifact. This factory is never imported by worker.ts. */
export function createHostedInstallOperator(input: HostedInstallPlan) {
  const plan=capturePlan(input);
  return Object.freeze({async fetch(request: Request, raw: unknown): Promise<Response> {
    const url=new URL(request.url);
    if(url.pathname!=='/__creezio/operator'||request.method!=='POST')return reply(404,{error:'not_found'});
    if(!plain(raw))return reply(503,{error:'operator_unavailable'});
    const env=raw as unknown as OperatorEnvironment,expiry=Number(env.CREEZIO_INSTALL_EXPIRES_AT);
    if(typeof env.CREEZIO_INSTALL_TOKEN!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(env.CREEZIO_INSTALL_TOKEN)
      ||!Number.isSafeInteger(expiry)||expiry<=Date.now()||expiry>Date.now()+3_600_000
      ||typeof env.CREEZIO_APP_ORIGIN!=='string'||url.origin!==env.CREEZIO_APP_ORIGIN
      ||url.protocol!=='https:'||!env.DB?.prepare||!env.DB?.batch)return reply(503,{error:'operator_unavailable'});
    const auth=request.headers.get('authorization');
    if(!auth||auth.length!==50||!auth.startsWith('Bearer ')
      ||!await sameToken(auth.slice(7),env.CREEZIO_INSTALL_TOKEN))return reply(401,{error:'unauthorized'});
    let body:Record<string,unknown>;
    try {body=await readInput(request);} catch{return reply(400,{error:'invalid_input'});}
    if(!['inspect','bootstrap'].includes(String(body.action))||body.planDigest!==plan.digest
      ||Object.keys(body).some(key=>!['action','planDigest',...(body.action==='bootstrap'?['loginIdentifier','displayName','password']:[])].includes(key)))
      return reply(400,{error:'invalid_input'});
    try {
      // First inspect bounded definitions, to distinguish schema refusal from a storage failure.
      const observed=await env.DB.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name LIMIT 1041').all();
      if(!observed.success)throw 0;
      const expected=[...plan.objects,...plan.providerObjects];
      const matches=observed.results.length===expected.length&&expected.every(o=>observed.results.some(a=>
        a.type===o.type&&a.name===o.name&&a.tbl_name===o.table&&a.sql===o.sql));
      if(!matches)return reply(409,{error:'schema_mismatch',objects:observed.results.map(o=>({type:o.type,name:o.name,table:o.tbl_name,sql:o.sql}))});
      const db=guardedDatabase(env.DB,plan);
      const marker=await db.prepare(`SELECT principal_id,expires_at_ms FROM "${ACCESS_TABLES.bootstrap}" WHERE id='installation'`).first();
      if(marker?.principal_id)return reply(200,{state:'installed',principalId:marker.principal_id,planDigest:plan.digest});
      const tables=plan.objects.filter(o=>o.type==='table'&&![ACCESS_TABLES.bootstrap,ACCESS_TABLES.auth_throttles].includes(o.name));
      const empty=await db.prepare(`SELECT ${tables.map(o=>`NOT EXISTS (SELECT 1 FROM "${o.name}" LIMIT 1)`).join(' AND ')} AS empty`).first();
      if(empty?.empty!==1)return reply(409,{error:'data_present'});
      if(body.action==='inspect')return reply(200,{state:marker?'capability_pending':'ready',planDigest:plan.digest,
        ...(marker?{expiresAtMs:marker.expires_at_ms}:{})});
      if(!normalizeLoginIdentifier(body.loginIdentifier)||!normalizeDisplayName(body.displayName)||!validNewPassword(body.password))
        return reply(400,{error:'invalid_input'});
      const capability=await provisionBootstrapCapability(db);
      if(!capability)return reply(409,{error:'bootstrap_unavailable'});
      const result=await createAccountService(db).bootstrap({token:capability.token,loginIdentifier:body.loginIdentifier,
        displayName:body.displayName,password:body.password});
      if(!result.ok)return reply(409,{error:result.code});
      return reply(200,{state:'installed',principalId:result.principalId,planDigest:plan.digest});
    } catch {return reply(503,{error:'outcome_unknown',inspectBeforeRetry:true});}
  }});
}
