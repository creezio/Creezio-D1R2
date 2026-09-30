import type {IdentityDatabase} from '../identity/d1-store.ts';
const hex=(value:string)=>Array.from(new TextEncoder().encode(value),byte=>byte.toString(16).padStart(2,'0')).join('');
const table=(model:string)=>`"cz_${hex('creezio.analytics')}_${hex(model)}"`;
export const ANALYTICS_COLLECTION_POLICY_TABLE = table('collection_policy');
const diagnostics = table('transport_refusal');
const codePattern = /^[A-Za-z][A-Za-z0-9._-]{0,79}$/u;
const routePattern = /^\/(?:[A-Za-z0-9._{}:-]+\/)*[A-Za-z0-9._{}:-]+$/u;
const methods = new Set(['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS']);

/** A best-effort, installation-scoped record written before operation admission.
 * The policy is off when absent. Its row is the only activation authority; callers
 * cannot supply a principal, request, URL, body, query, headers or arbitrary metadata. */
export async function recordPreEngineRefusal(input:{db:IdentityDatabase;transport:'api'|'mcp';
  method:string;routeTemplate:string;status:number;code:string;startedAtMs:number}):Promise<void>{
  if(!methods.has(input.method)||!routePattern.test(input.routeTemplate)
    ||input.routeTemplate.length>512||!codePattern.test(input.code)
    ||!Number.isSafeInteger(input.status)||input.status<400||input.status>599
    ||!Number.isSafeInteger(input.startedAtMs)||input.startedAtMs<0)return;
  const now=Date.now();
  try{await input.db.prepare(`INSERT INTO ${diagnostics}
    (id,transport,method,route_template,status,error_code,created_at_ms,duration_ms)
    SELECT ?,?,?,?,?,?,?,? WHERE EXISTS
    (SELECT 1 FROM ${ANALYTICS_COLLECTION_POLICY_TABLE} WHERE id='application' AND refusals_enabled=1)
    AND (SELECT COUNT(*) FROM ${diagnostics})<10000`)
    .bind(crypto.randomUUID(),input.transport,input.method,input.routeTemplate,input.status,
      input.code,now,Math.max(0,now-input.startedAtMs)).run();}
  catch{/* Diagnostics cannot affect the transport response or expose its failure. */}
}
