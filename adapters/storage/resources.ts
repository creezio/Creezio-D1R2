import {resolveBindings, type RuntimeBindings} from './bindings.ts';
import type {RuntimeProfile} from '../runtime-profiles.ts';

const CONTEXT = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const INSTALLATION = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SLOT_COUNT = 16;
type ResourceRoute = Readonly<{contextId:string;slot:number;status:'active'|'revoked'}>;
export type StorageRoutes = Readonly<{schemaVersion:1;routes:readonly ResourceRoute[]}>
  | Readonly<{schemaVersion:2;storageInstallationId:string;routes:readonly ResourceRoute[]}>;
export type StorageResource = RuntimeBindings & Readonly<{slot:number}>;

function plain(value:unknown):value is Record<string,unknown> {
  return !!value && typeof value==='object' && !Array.isArray(value)
    && [Object.prototype,null].includes(Object.getPrototypeOf(value));
}
function keys(value:Record<string,unknown>, expected:readonly string[]):boolean {
  return Object.keys(value).sort().join(',') === [...expected].sort().join(',');
}
export function resourceBindingNames(slot:number):Readonly<{database:string;bucket:string}> {
  if(!Number.isInteger(slot)||slot<1||slot>SLOT_COUNT)throw new Error('Invalid storage slot.');
  const suffix=String(slot).padStart(2,'0');
  return Object.freeze({database:`DB_RESOURCE_${suffix}`,bucket:`BUCKET_RESOURCE_${suffix}`});
}

/** A deployment owned mapping; client supplied context identifiers never grant access. */
export function validateStorageRoutes(value:unknown):StorageRoutes {
  if(!plain(value)||(value.schemaVersion!==1&&value.schemaVersion!==2)
    ||!keys(value,value.schemaVersion===2?['schemaVersion','storageInstallationId','routes']:['schemaVersion','routes'])
    ||value.schemaVersion===2&&(typeof value.storageInstallationId!=='string'
      ||!INSTALLATION.test(value.storageInstallationId))
    ||!Array.isArray(value.routes)||value.routes.length<1||value.routes.length>SLOT_COUNT)
    throw new Error('Invalid storage routes.');
  const contexts=new Set<string>(), slots=new Set<number>();
  const routes=value.routes.map(raw=>{
    const slot=plain(raw)?raw.slot:undefined;
    if(!plain(raw)||!keys(raw,['contextId','slot','status'])
      ||typeof raw.contextId!=='string'||!CONTEXT.test(raw.contextId)
      ||raw.contextId==='application'||typeof slot!=='number'||!Number.isInteger(slot)
      ||slot<1||slot>SLOT_COUNT||!['active','revoked'].includes(String(raw.status))
      ||contexts.has(raw.contextId)||slots.has(slot))throw new Error('Invalid storage routes.');
    contexts.add(raw.contextId);slots.add(slot);
    return Object.freeze({contextId:raw.contextId,slot,status:raw.status as ResourceRoute['status']});
  });
  return value.schemaVersion===2
    ?Object.freeze({schemaVersion:2,storageInstallationId:value.storageInstallationId as string,routes:Object.freeze(routes)})
    :Object.freeze({schemaVersion:1,routes:Object.freeze(routes)});
}

/** Only a caller that has resolved native identity and current ACL may use the selected storage. */
export function createStorageResourceResolver(environment:unknown, profile:RuntimeProfile,
  routes:unknown):Readonly<{resolve:(authorizedContextId:string)=>StorageResource}> {
  const primary=resolveBindings(environment);
  if(!primary||!environment||typeof environment!=='object')throw new Error('Storage bindings unavailable.');
  if(profile==='sites'&&routes!==undefined)throw new Error('Sites has one shared storage pair.');
  const manifest=routes===undefined?null:validateStorageRoutes(routes);
  const source=environment as Record<string,unknown>;
  const resources=new Map<number,StorageResource>();
  if(manifest)for(const route of manifest.routes){
    if(route.status==='revoked')continue;
    const names=resourceBindingNames(route.slot);
    const bindings=resolveBindings({DB:source[names.database],BUCKET:source[names.bucket]});
    if(!bindings)throw new Error('Storage bindings unavailable.');
    resources.set(route.slot,Object.freeze({...bindings,slot:route.slot}));
  }
  const principal=Object.freeze({...primary,slot:0});
  return Object.freeze({resolve(authorizedContextId:string):StorageResource {
    if(typeof authorizedContextId!=='string'||!CONTEXT.test(authorizedContextId))
      throw new Error('Invalid storage context.');
    if(!manifest||authorizedContextId==='application')return principal;
    const route=manifest.routes.find(item=>item.contextId===authorizedContextId);
    if(!route||route.status!=='active')throw new Error('Storage route unavailable.');
    const binding=resources.get(route.slot);
    if(!binding)throw new Error('Storage bindings unavailable.');
    return binding;
  }});
}
