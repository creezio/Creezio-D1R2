import type {DataRecord,JsonValue} from '../data/types.ts';

const encoder=new TextEncoder();
const canonical=(value:JsonValue):string=>value&&typeof value==='object'
  ?Array.isArray(value)?`[${value.map(canonical).join(',')}]`
    :`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical((value as DataRecord)[key])}`).join(',')}}`
  :JSON.stringify(value);
/** Must match the Engine's idempotency and input digest exactly. */
export async function operationDigest(value:JsonValue):Promise<string> {
  const bytes=await crypto.subtle.digest('SHA-256',encoder.encode(canonical(value)));
  return `sha256:${Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('')}`;
}
