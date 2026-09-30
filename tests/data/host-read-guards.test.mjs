import '../../scripts/local-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Miniflare} from 'miniflare';
import {generateD1Schema} from '../../scripts/data/d1-schema.mjs';
import {createDataAccess,bindHostReadGuards} from '../../core/data/service.ts';
import {createAccountService,provisionBootstrapCapability} from '../../core/identity/accounts.ts';
import {createAuthorizationService} from '../../core/authorization/service.ts';

const owner='example.owner',provider='example.provider';
const field=(id,protectedField=false)=>({id,type:'string',nullable:false,protected:protectedField,computed:false});
const descriptor=(moduleId,protectedFields)=>{
  const permission={id:'use',title:'Use',audiences:['admin'],actors:['user'],scopes:['records'],
    context:'required',default:'deny',resources:[{moduleId,kind:'model',id:'record'}],
    actions:protectedFields?['read']:['read','create','update'],enforcement:{request:true,commit:true},public:false};
  const model={id:'record',title:'Record',scope:'context',contextField:'context_id',
    fields:[field('context_id',true),field('id',protectedFields),field('value',protectedFields)],
    primaryKey:['context_id','id'],indexes:[],relations:[],
    permissions:[{moduleId,kind:'permission',id:'use'}],deletion:{mode:'hard',requiresApproval:false},public:false};
  const schema=generateD1Schema(moduleId,[model]);
  return {moduleId,permission,model,schema};
};
const modules=[descriptor(owner,false),descriptor(provider,true)];
const permissions=modules.map(item=>({id:`${item.moduleId}:use`,audiences:['admin'],actors:['user']}));
const catalog={schemaVersion:1,compositionDigest:`sha256-${'6'.repeat(64)}`,modules:modules.map(item=>({
  moduleId:item.moduleId,version:'1.0.0',enabled:true,permissions:[item.permission],
  models:[{modelId:'record',table:item.schema.tables.record,model:item.model}]}))};
const good=value=>{assert.equal(value.ok,true,JSON.stringify(value));return value;};

test('host read proofs retain provider authority and cannot import writes or cross scopes', {timeout:45000}, async()=>{
  const runtime=new Miniflare({host:'127.0.0.1',port:0,cf:false,modules:true,
    compatibilityDate:'2026-05-15',script:'export default {fetch(){return new Response(null)}}',
    d1Databases:{DB:'creezio-host-read-guard-proof'},d1Persist:false});
  try{
    const db=await runtime.getD1Database('DB');
    const access=generateD1Schema('creezio.access',JSON.parse(readFileSync(
      new URL('../../extensions/native/access/module/models.json',import.meta.url),'utf8')));
    await db.batch([...access.statements,...modules.flatMap(item=>item.schema.statements)].map(sql=>db.prepare(sql)));
    const accounts=createAccountService(db),bootstrap=await provisionBootstrapCapability(db);
    const identity={loginIdentifier:'read-guards@example.invalid',displayName:'Read guards',
      password:'Synthetic host read guards qualification password'};
    const principal=good(await accounts.bootstrap({...identity,token:bootstrap.token}));
    const login={loginIdentifier:identity.loginIdentifier,password:identity.password,audience:'admin'};
    const session=good(await accounts.login(login));
    const second=good(await accounts.login(login));
    const credential={kind:'session',token:session.token};
    const acl=createAuthorizationService(db,{permissions}),initial=good(await acl.readPolicy(session.token));
    const policy=structuredClone(initial.policy);
    policy.roles.push({id:'guard-owner',inherits:[],permissionIds:permissions.map(item=>item.id),permissionOverrides:[]});
    for(const contextId of ['guard-a','guard-b']){
      policy.contexts.push({id:contextId,status:'active'});
      policy.memberships.push({principalId:principal.principalId,contextId,audience:'admin',status:'active'});
      policy.assignments.push({principalId:principal.principalId,contextId,audience:'admin',roleId:'guard-owner'});
    }
    good(await acl.replacePolicy(session.token,{expectedEpoch:initial.epoch,policy}));
    await db.prepare(`INSERT INTO "${modules[1].schema.tables.record}" (context_id,id,value) VALUES(?,?,?)`)
      .bind('guard-a','configuration','version-one').run();
    const data=createDataAccess(db,{catalog,permissions});
    const authorize=(moduleId,contextId='guard-a',issued=credential)=>data.authorize(issued,
      {contextId,audience:'admin',actors:['user'],requiredPermissionIds:[`${moduleId}:use`],purpose:'operation'}, {moduleId});
    const source=await authorize(provider),destination=await authorize(owner);
    const port=data.forModule(destination,owner);
    const internal=data.internalPort(source,{moduleId:provider,modelId:'record',fields:['id','value']});
    const proof=()=>internal.planGet('record',{key:{id:'configuration'},where:{value:'version-one'},required:true,fields:['id']});
    assert.equal(Object.hasOwn(data,'bindReadGuards'),false);
    assert.throws(()=>data.forModule(destination,provider),{code:'forbidden'});
    await assert.rejects(()=>data.forModule(source,provider).get('record',{key:{id:'configuration'},fields:['value']}),{code:'forbidden'});
    const original=proof();
    await assert.rejects(()=>data.readBatch(destination,[original]),{code:'invalid_plan'});
    const borrowed=bindHostReadGuards(data,source,destination,[original]);
    await data.commitBatch(destination,[...borrowed,port.planCreate('record',{values:{id:'first',value:'confirmed'}})]);
    assert.equal((await port.get('record',{key:{id:'first'}})).value,'confirmed');

    const write=port.planCreate('record',{values:{id:'not-imported',value:'no'}});
    assert.throws(()=>bindHostReadGuards(data,destination,source,[write]),{code:'invalid_plan'});
    assert.throws(()=>bindHostReadGuards(data,source,destination,[{kind:'data-plan'}]),{code:'invalid_plan'});
    const duplicated=proof();
    assert.throws(()=>bindHostReadGuards(data,source,destination,[duplicated,duplicated]),{code:'invalid_plan'});
    const otherContext=await authorize(owner,'guard-b');
    assert.throws(()=>bindHostReadGuards(data,source,otherContext,[proof()]),{code:'forbidden'});
    const otherCredential=await authorize(owner,'guard-a',{kind:'session',token:second.token});
    assert.throws(()=>bindHostReadGuards(data,source,otherCredential,[proof()]),{code:'forbidden'});
    const otherData=createDataAccess(db,{catalog,permissions});
    assert.throws(()=>bindHostReadGuards(otherData,source,destination,[proof()]),{code:'invalid_lease'});
    let accessorRead=false;const accessor=[];Object.defineProperty(accessor,'0',{get(){accessorRead=true;return proof();},enumerable:true});
    assert.throws(()=>bindHostReadGuards(data,source,destination,accessor),{code:'invalid_plan'});
    assert.equal(accessorRead,false);
    const tooManyStatements=bindHostReadGuards(data,source,destination,Array.from({length:16},proof));
    await assert.rejects(()=>data.commitBatch(destination,[...tooManyStatements.slice(0,15),
      port.planCreate('record',{values:{id:'over-budget',value:'no'}})]),{code:'invalid_plan'});
    assert.equal(await port.get('record',{key:{id:'over-budget'}}),null);

    const configProof=bindHostReadGuards(data,source,destination,[proof()]);
    await db.prepare(`UPDATE "${modules[1].schema.tables.record}" SET value=? WHERE context_id=? AND id=?`)
      .bind('version-two','guard-a','configuration').run();
    await assert.rejects(()=>data.commitBatch(destination,[...configProof,
      port.planCreate('record',{values:{id:'changed-provider',value:'no'}})]));
    assert.equal(await port.get('record',{key:{id:'changed-provider'}}),null);
    await db.prepare(`UPDATE "${modules[1].schema.tables.record}" SET value=? WHERE context_id=? AND id=?`)
      .bind('version-one','guard-a','configuration').run();

    // Destination is refreshed after the policy change: only the borrowed provider
    // proof retains the old epoch, so its own guard must reject this settlement.
    const prior=good(await acl.readPolicy(session.token)),revoked=structuredClone(prior.policy);
    revoked.roles.find(item=>item.id==='guard-owner').permissionIds=[`${owner}:use`];
    good(await acl.replacePolicy(session.token,{expectedEpoch:prior.epoch,policy:revoked}));
    const freshDestination=await authorize(owner),freshPort=data.forModule(freshDestination,owner);
    const oldProviderProof=bindHostReadGuards(data,source,freshDestination,[proof()]);
    await freshPort.create('record',{values:{id:'owner-still-authorized',value:'yes'}});
    await assert.rejects(()=>data.commitBatch(freshDestination,[...oldProviderProof,
      freshPort.planCreate('record',{values:{id:'revoked-provider',value:'no'}})]));
    assert.equal(await freshPort.get('record',{key:{id:'revoked-provider'}}),null);
    data.dispose(source);
    assert.throws(()=>bindHostReadGuards(data,source,freshDestination,[original]),{code:'invalid_lease'});
  }finally{await runtime.dispose();}
});
