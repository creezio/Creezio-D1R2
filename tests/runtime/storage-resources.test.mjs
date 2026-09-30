import test from 'node:test';
import assert from 'node:assert/strict';
import {createStorageResourceResolver,resourceBindingNames,validateStorageRoutes} from '../../adapters/storage/resources.ts';
import {resolveRuntimeEnvironment} from '../../core/runtime/environment.ts';
import {createStorageAuthorityHost} from '../../core/storage-authority/host.ts';

const unused=()=>{throw new Error('Storage must not be probed by the resolver.');};
const pair=()=>({DB:{prepare:unused,batch:unused},BUCKET:{get:unused,head:unused,put:unused,delete:unused}});
const routes={schemaVersion:1,routes:[
  {contextId:'tenant-a',slot:1,status:'active'},
  {contextId:'tenant-b',slot:2,status:'revoked'}]};
function environment(profile='cloudflare'){
  const primary=pair(),secondary=pair();
  return {...primary,CREEZIO_RUNTIME_PROFILE:profile,CREEZIO_STORAGE_ROUTES:JSON.stringify(routes),
    DB_RESOURCE_01:secondary.DB,BUCKET_RESOURCE_01:secondary.BUCKET};
}

test('one Worker selects an explicitly bound pair for a server-authorized context',()=>{
  const env=environment(),resolved=resolveRuntimeEnvironment(env);
  assert.ok(resolved?.storage);
  assert.equal(resolved.storage.resolve('application').DB,env.DB);
  assert.equal(resolved.storage.resolve('tenant-a').DB,env.DB_RESOURCE_01);
  assert.equal(resolved.storage.resolve('tenant-a').BUCKET,env.BUCKET_RESOURCE_01);
  assert.equal(resolved.storage.resolve('tenant-a').slot,1);
  assert.ok(Object.isFrozen(resolved.storage.resolve('tenant-a')));
  assert.throws(()=>resolved.storage.resolve('tenant-b'),/unavailable/);
  assert.throws(()=>resolved.storage.resolve('tenant-c'),/unavailable/);
});

test('Sites and legacy local use the primary pair under the same resolver contract',()=>{
  const sites=pair(),local=pair();
  assert.equal(createStorageResourceResolver(sites,'sites',undefined).resolve('tenant-a').DB,sites.DB);
  assert.equal(createStorageResourceResolver(local,'local',undefined).resolve('tenant-a').BUCKET,local.BUCKET);
  assert.equal(resolveRuntimeEnvironment({...sites,CREEZIO_RUNTIME_PROFILE:'sites',
    CREEZIO_STORAGE_ROUTES:JSON.stringify(routes)}),null);
});

test('active route without both deployed bindings fails before any request',()=>{
  const env=environment();delete env.BUCKET_RESOURCE_01;
  assert.equal(resolveRuntimeEnvironment(env),null);
  assert.throws(()=>createStorageResourceResolver(env,'cloudflare',routes),/unavailable/);
});

test('malformed, duplicated and forged routes are rejected without fallback',()=>{
  for(const manifest of [
    {schemaVersion:1,routes:[]},
    {schemaVersion:1,routes:[{contextId:'tenant-a',slot:1,status:'active'},
      {contextId:'tenant-a',slot:2,status:'active'}]},
    {schemaVersion:1,routes:[{contextId:'tenant-a',slot:1,status:'active'},
      {contextId:'tenant-b',slot:1,status:'active'}]},
    {schemaVersion:1,routes:[{contextId:'application',slot:1,status:'active'}]},
    {schemaVersion:1,routes:[{contextId:'tenant-a',slot:17,status:'active'}]},
    {schemaVersion:1,routes:[{contextId:'tenant-a',slot:1,status:'active',secret:'x'}]}
  ])assert.throws(()=>validateStorageRoutes(manifest));
  assert.throws(()=>resourceBindingNames(0));
  assert.equal(resolveRuntimeEnvironment({...environment(),CREEZIO_STORAGE_ROUTES:'{"routes":'}),null);
  assert.equal(validateStorageRoutes({schemaVersion:2,storageInstallationId:
    'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',routes:routes.routes}).schemaVersion,2);
  assert.throws(()=>validateStorageRoutes({schemaVersion:2,storageInstallationId:'foreign',routes:routes.routes}));
});

test('host factory carries primary authority and complete active inventory into routed selection',()=>{
  const env=environment();
  const manifest={schemaVersion:2,storageInstallationId:'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    routes:routes.routes};
  const host=createStorageAuthorityHost(env,'cloudflare',manifest);
  assert.equal(host.authorityDb,env.DB);
  assert.equal(host.inventory.length,1);
  assert.ok(host.storageMutation);
  assert.deepEqual(host.inventory[0].identity,{installationId:manifest.storageInstallationId,
    contextId:'tenant-a',slot:1});
  const selected=host.forContext('tenant-a');
  assert.equal(selected.db,env.DB_RESOURCE_01);
  assert.equal(selected.bucket,env.BUCKET_RESOURCE_01);
  assert.equal(selected.authorityDb,env.DB);
  assert.deepEqual(selected.storageRoute,host.inventory[0].identity);
  assert.equal(host.forContext('application').db,env.DB);
  assert.throws(()=>host.forContext('tenant-b'),/unavailable/);
  assert.throws(()=>createStorageAuthorityHost(env,'cloudflare',routes),/physical installation/);
  const sites=createStorageAuthorityHost(pair(),'sites',undefined);
  assert.equal(sites.storageMutation,null);
  assert.equal(sites.forContext('tenant-a').db,sites.authorityDb);
  const resolved=resolveRuntimeEnvironment({...env,CREEZIO_STORAGE_ROUTES:JSON.stringify(manifest)});
  assert.ok(resolved.storageAuthority);
  assert.equal(resolved.storageAuthority.forContext('tenant-a').db,env.DB_RESOURCE_01);
  assert.equal(resolveRuntimeEnvironment(env).storageAuthority,undefined);
});
