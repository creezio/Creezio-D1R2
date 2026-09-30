import test from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare,Log,LogLevel} from 'miniflare';
import {describeD1Schema} from '../../scripts/data/d1-schema.mjs';
import {createStorageFixture,moduleId,catalog,permissions,schema,table} from '../data/fixtures/storage.mjs';
import {createAuthorizationService} from '../../core/authorization/service.ts';
import {createDataAccess} from '../../core/data/service.ts';
import {createDataAuthorization} from '../../core/data/authorization.ts';
import {ACCESS_TABLES} from '../../core/identity/d1-store.ts';
import {STORAGE_AUTHORITY_MODELS,STORAGE_AUTHORITY_MODULE_ID,STORAGE_AUTHORITY_TABLES}
  from '../../core/storage-authority/models.ts';
import {prepareStorageRevocation,fenceStorageRoute,markStorageSourceAttempted,
  confirmStorageSource,reopenStorageRoute}
  from '../../core/storage-authority/coordinator.ts';
import {readActiveStorageRoute,projectScopedStorageGrant,freshScopedStorageGuard,
  activeStorageCompositionCondition}
  from '../../core/storage-authority/target.ts';
import {createRoutedNativeSessionLogout} from '../../core/storage-authority/native-session.ts';
import {appendStorageCompositionReceipt} from './fixtures/schema-receipt.mjs';

const authority=describeD1Schema(STORAGE_AUTHORITY_MODULE_ID,STORAGE_AUTHORITY_MODELS);
const routeTable=`"${STORAGE_AUTHORITY_TABLES.storage_routes}"`;
const installationId='qualification-t33';
const lockDigest=`sha256-${'7'.repeat(64)}`;
const routedCatalog={...catalog,lockDigest};
const credential=token=>({kind:'session',token});
const target=contextId=>({contextId,audience:'admin',actors:['user'],requiredPermissionIds:[],purpose:'operation'});

test('two real target D1s isolate the same module and fence both before native logout succeeds',
  {timeout:60000},async()=>{
  const principal=await createStorageFixture();
  const local=new Miniflare({host:'127.0.0.1',port:0,cf:false,modules:true,
    script:'export default {fetch(){return new Response(null,{status:404})}}',
    compatibilityDate:'2026-05-15',d1Databases:{A:'creezio-t33-authority-a',B:'creezio-t33-authority-b'},
    d1Persist:false,telemetry:{enabled:false},logRequests:false,log:new Log(LogLevel.NONE)});
  try{
    const source=principal.db,a=await local.getD1Database('A'),b=await local.getD1Database('B');
    await source.batch(authority.statements.map(sql=>source.prepare(sql)));
    const acl=createAuthorizationService(source,{permissions});
    const current=await acl.readPolicy(principal.signed.token);assert.equal(current.ok,true);
    const policy=structuredClone(current.policy);
    policy.contexts.push({id:'tenant-b',status:'active'});
    policy.memberships.push({principalId:principal.owner.principalId,contextId:'tenant-b',audience:'admin',status:'active'});
    policy.assignments.push({principalId:principal.owner.principalId,contextId:'tenant-b',audience:'admin',roleId:'storage'});
    assert.equal((await acl.replacePolicy(principal.signed.token,{expectedEpoch:current.epoch,policy})).ok,true);
    const epoch=(await source.prepare(`SELECT epoch FROM "${ACCESS_TABLES.authorization_state}" WHERE id='application'`).first()).epoch;
    const identities=[{installationId,contextId:'other',slot:1},{installationId,contextId:'tenant-b',slot:2}];
    for(const [database,identity] of [[a,identities[0]],[b,identities[1]]]){
      await database.batch([...schema.statements,...authority.statements].map(sql=>database.prepare(sql)));
      await appendStorageCompositionReceipt(database,catalog.compositionDigest,lockDigest);
      await database.prepare(`INSERT INTO ${routeTable}
        (id,installation_id,slot,generation,state,mutation_id,source_epoch,updated_at_ms)
        VALUES (?,?,?,1,'active',NULL,?,0)`)
        .bind(identity.contextId,installationId,identity.slot,epoch).run();
    }
    const accessA=createDataAccess(a,{catalog:routedCatalog,permissions,authorityDb:source,storageRoute:identities[0]});
    const accessB=createDataAccess(b,{catalog:routedCatalog,permissions,authorityDb:source,storageRoute:identities[1]});
    const leaseA=await accessA.authorize(credential(principal.signed.token),target('other'),{moduleId});
    const leaseB=await accessB.authorize(credential(principal.signed.token),target('tenant-b'),{moduleId});
    const portA=accessA.forModule(leaseA,moduleId),portB=accessB.forModule(leaseB,moduleId);
    await portA.create('record',{values:{id:'same',title:'first'}});
    await portB.create('record',{values:{id:'same',title:'second'}});
    assert.equal((await a.prepare(`SELECT title FROM ${table('record')} WHERE id='same'`).first()).title,'first');
    assert.equal((await b.prepare(`SELECT title FROM ${table('record')} WHERE id='same'`).first()).title,'second');
    const oldRoute=await readActiveStorageRoute(a,identities[0]);
    const oldAuthority=await createDataAuthorization(source,permissions)
      .resolve(credential(principal.signed.token),target('other'));
    const expired=await projectScopedStorageGrant(a,oldRoute,
      {...oldAuthority,validUntilMs:Date.now()-1000},moduleId,catalog.compositionDigest,lockDigest);
    const renewed=await projectScopedStorageGrant(a,oldRoute,
      {...oldAuthority,validUntilMs:Date.now()+30000},moduleId,catalog.compositionDigest,lockDigest);
    assert.equal(expired.id,renewed.id);
    const staleGuard=freshScopedStorageGuard(expired),liveGuard=freshScopedStorageGuard(renewed);
    const publicCondition=activeStorageCompositionCondition(identities[0],catalog.compositionDigest,lockDigest);
    const publicVisibility=()=>a.prepare(`SELECT CASE WHEN ${publicCondition.sql}
      THEN 1 ELSE 0 END AS visible`).bind(...publicCondition.bindings).first('visible');
    assert.equal(await publicVisibility(),1);
    await assert.rejects(a.batch([a.prepare(staleGuard.sql).bind(...staleGuard.bindings)]));
    assert.equal((await a.batch([a.prepare(liveGuard.sql).bind(...liveGuard.bindings)]))[0].results[0].allowed,1);
    await appendStorageCompositionReceipt(a,catalog.compositionDigest,`sha256-${'e'.repeat(64)}`);
    assert.equal(await publicVisibility(),0);
    await assert.rejects(projectScopedStorageGrant(a,oldRoute,oldAuthority,moduleId,
      catalog.compositionDigest,lockDigest),
      {code:'conflict'});
    await assert.rejects(a.batch([a.prepare(liveGuard.sql).bind(...liveGuard.bindings)]));
    await assert.rejects(portA.create('record',{values:{id:'stale-catalog',title:'denied'}}),
      {code:'storage_error'});
    assert.equal(await a.prepare(`SELECT id FROM ${table('record')} WHERE id='stale-catalog'`).first(),null);
    // A synthetic fixture can switch back; a real cutover also fences the route generation.
    await appendStorageCompositionReceipt(a,catalog.compositionDigest,lockDigest);
    assert.equal(await publicVisibility(),1);

    const commands=identities.map((identity,index)=>({...identity,mutationId:`logout-${index+1}`,
      commandDigest:`sha256-${String(index+1).repeat(64)}`,expectedGeneration:1}));
    await assert.rejects(confirmStorageSource(source,commands[0],async()=>true),{code:'conflict'});
    for(const [database,command] of [[a,commands[0]],[b,commands[1]]]){
      assert.equal(await prepareStorageRevocation(source,command),'prepared');
      assert.equal(await fenceStorageRoute(source,database,command),'fenced');
      assert.equal(await fenceStorageRoute(source,database,command),'fenced');
    }
    assert.equal(await publicVisibility(),0);
    await assert.rejects(reopenStorageRoute(source,a,commands[0],epoch),{code:'conflict'});
    await assert.rejects(confirmStorageSource(source,commands[0],async()=>false),{code:'conflict'});
    await assert.rejects(projectScopedStorageGrant(a,oldRoute,oldAuthority,moduleId,
      catalog.compositionDigest,lockDigest),{code:'conflict'});
    await assert.rejects(portA.create('record',{values:{id:'after-fence',title:'denied'}}),{code:'storage_error'});
    await assert.rejects(portB.create('record',{values:{id:'after-fence',title:'denied'}}),{code:'storage_error'});
    for(const command of commands)assert.equal(await markStorageSourceAttempted(source,command),'source-attempted');
    await assert.rejects(confirmStorageSource(source,commands[0],async()=>false),{code:'unavailable'});
    assert.equal(await principal.accounts.logout(principal.signed.token,'admin'),true);
    assert.equal(await principal.accounts.session(principal.signed.token,'admin'),null);
    for(const [database,command] of [[a,commands[0]],[b,commands[1]]]){
      assert.equal(await confirmStorageSource(source,command,async()=>
        await principal.accounts.session(principal.signed.token,'admin')===null),'source-confirmed');
      assert.equal(await reopenStorageRoute(source,database,command,epoch),'open');
      assert.equal(await reopenStorageRoute(source,database,command,epoch),'open');
    }
    await assert.rejects(projectScopedStorageGrant(a,oldRoute,oldAuthority,moduleId,
      catalog.compositionDigest,lockDigest),{code:'conflict'});
    await assert.rejects(portA.create('record',{values:{id:'after-open',title:'denied'}}),{code:'storage_error'});
    await assert.rejects(accessA.authorize(credential(principal.signed.token),target('other'),{moduleId}),
      {code:'unauthorized'});
    const newLogin=await principal.accounts.login({loginIdentifier:'storage@example.invalid',
      password:'Synthetic storage qualification password',audience:'admin'});
    assert.equal(newLogin.ok,true);
    const newLease=await accessA.authorize(credential(newLogin.token),target('other'),{moduleId});
    await accessA.forModule(newLease,moduleId).create('record',{values:{id:'after-new-login',title:'allowed'}});
    const routedLogout=createRoutedNativeSessionLogout(source,[{identity:identities[0],db:a},{identity:identities[1],db:b}]);
    assert.deepEqual(await routedLogout.logout(newLogin.token,'admin'),{state:'revoked'});
    assert.deepEqual(await routedLogout.logout(newLogin.token,'admin'),{state:'revoked'});
    await assert.rejects(accessA.forModule(newLease,moduleId).create('record',
      {values:{id:'after-routed-logout',title:'denied'}}),{code:'storage_error'});
    const thirdLogin=await principal.accounts.login({loginIdentifier:'storage@example.invalid',
      password:'Synthetic storage qualification password',audience:'admin'});
    assert.equal(thirdLogin.ok,true);
    const unavailable={prepare(){throw new Error('secret provider detail');},batch(){throw new Error('secret provider detail');}};
    const blocked=createRoutedNativeSessionLogout(source,[{identity:identities[0],db:a},
      {identity:identities[1],db:unavailable}]);
    assert.deepEqual(await blocked.logout(thirdLogin.token,'admin'),{state:'pending'});
    assert.ok(await principal.accounts.session(thirdLogin.token,'admin'));
  }finally{await local.dispose();await principal.dispose();}
});
