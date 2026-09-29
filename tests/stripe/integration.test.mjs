import '../../scripts/local-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {Miniflare} from 'miniflare';
import {buildSync} from 'esbuild';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import {Client,StreamableHTTPClientTransport} from '@modelcontextprotocol/client';
import {generateD1Schema} from '../../scripts/data/d1-schema.mjs';
import {OPERATION_MODELS,OPERATION_STORAGE_MODULE_ID} from '../../core/operations/models.ts';
import {createAccountService,provisionBootstrapCapability} from '../../core/identity/accounts.ts';
import {createMachineAccountService} from '../../core/identity/machines.ts';
import {createAuthorizationService} from '../../core/authorization/service.ts';
import {createOperationRegistry} from '../../core/operations/registry.ts';
import {createOperationEngine} from '../../core/operations/service.ts';
import {createOperationHttpTransport} from '../../core/operations/http.ts';
import {createMcpHttpTransport} from '../../core/mcp/http.ts';
import {createVaultKeyring} from '../../core/vault/crypto.ts';
import {compileHttpBindings} from '../../scripts/operations/http-bindings.mjs';
import {compileMcpBindings} from '../../scripts/mcp/bindings.mjs';
import {compileWidgetCatalog} from '../../scripts/widgets/compile.mjs';
import * as handlers from '../../extensions/connectors/stripe/module/operations.ts';
import {stripeConnectorDescriptor} from '../../extensions/connectors/stripe/module/storage.ts';

const json=path=>JSON.parse(readFileSync(new URL(path,import.meta.url),'utf8'));
const manifest=json('../../extensions/connectors/stripe/module/manifest.json'),moduleId=manifest.identity.id;
const digest=`sha256-${'7'.repeat(64)}`;
const generated=generateD1Schema(moduleId,manifest.contracts.models);
const access=generateD1Schema('creezio.access',json('../../extensions/native/access/module/models.json'));
const technical=generateD1Schema(OPERATION_STORAGE_MODULE_ID,OPERATION_MODELS);
const permissions=manifest.contracts.permissions.map(item=>({id:`${moduleId}:${item.id}`,
  audiences:item.audiences,actors:item.actors}));
const catalog={schemaVersion:1,compositionDigest:digest,modules:[{moduleId,version:manifest.identity.version,
  enabled:true,permissions:manifest.contracts.permissions,models:manifest.contracts.models.map(model=>({
    modelId:model.id,table:generated.tables[model.id],model}))}]};
const composition={modules:[{moduleId,enabled:true}],exposure:{admin:{moduleIds:[moduleId]},app:{moduleIds:[]}}};
function registry(){
  const ajv=addFormats(new Ajv2020({strict:true,allErrors:false,coerceTypes:false,removeAdditional:false}));
  const validators={},names=new Map();
  for(const [index,item] of manifest.contracts.schemas.entries()){
    const name=`schema_${index}`;names.set(item.id,name);validators[name]=ajv.compile(item.schema);
  }
  const operationCatalog={schemaVersion:1,compositionDigest:digest,modules:[{moduleId,
    version:manifest.identity.version,enabled:true,
    schemas:[...names].map(([schemaId,validator])=>({schemaId,validator})),
    operations:manifest.contracts.operations.map(operation=>({operation,active:true,contractDigest:digest,
      inputValidator:names.get(operation.input.schemaId),outputValidator:names.get(operation.output.schemaId)}))}]};
  return createOperationRegistry({catalog:operationCatalog,validators,
    handlers:Object.fromEntries(manifest.contracts.operations.map(op=>
      [`${moduleId}:${op.id}`,handlers[op.handler.export]]))});
}
const good=value=>{assert.equal(value.ok,true,JSON.stringify(value));return value;};
const success=value=>{assert.equal(value.execution?.state,'succeeded',JSON.stringify(value));return value.execution.output;};
const failed=async(promise,code)=>{
  const value=await promise.catch(error=>error);
  assert.notEqual(value.execution?.state,'succeeded');
  assert.equal(value.code??value.execution?.errorCode,code,JSON.stringify(value));
};
const customer=(id,account)=>({id,object:'customer',livemode:false,name:`${account}-${id}`,
  email:'not-projected@example.invalid',metadata:{token:'never-expose'}});

test('Stripe GET-only connector commits pages atomically in D1 and scopes API/MCP projections',
  {timeout:90000},async()=>{
    const runtime=new Miniflare({host:'127.0.0.1',port:0,cf:false,modules:true,
      compatibilityDate:'2026-05-15',script:'export default {fetch(){return new Response(null,{status:404})}}',
      d1Databases:{DB:'creezio-stripe-integration'},d1Persist:false});
    let mcpClient;
    try{
      const db=await runtime.getD1Database('DB');
      await db.batch([...access.statements,...technical.statements,...generated.statements].map(sql=>db.prepare(sql)));
      const accounts=createAccountService(db),bootstrap=await provisionBootstrapCapability(db);
      const password='Synthetic Stripe connector qualification password';
      const owner=good(await accounts.bootstrap({token:bootstrap.token,loginIdentifier:'stripe-owner@example.invalid',
        displayName:'Stripe owner',password}));
      const admin=good(await accounts.login({loginIdentifier:'stripe-owner@example.invalid',password,audience:'admin'}));
      const app=good(await accounts.login({loginIdentifier:'stripe-owner@example.invalid',password,audience:'app'}));
      const machines=createMachineAccountService(db,{permissions});
      const machine=good(await machines.createService(admin.token,{displayName:'Stripe reader'})).principal;
      const acl=createAuthorizationService(db,{permissions});
      const before=good(await acl.readPolicy(admin.token)),policy=structuredClone(before.policy);
      policy.roles.push({id:'stripe-admin',inherits:[],permissionIds:[`${moduleId}:manage`,`${moduleId}:read`],
        permissionOverrides:[]},{id:'stripe-reader',inherits:[],permissionIds:[`${moduleId}:read`],
        permissionOverrides:[]});
      policy.contexts.push({id:'other',status:'active'});
      for(const [principalId,audience,contextId,roleId] of [[owner.principalId,'admin','application','stripe-admin'],
        [owner.principalId,'admin','other','stripe-reader'],[machine.id,'admin','application','stripe-reader']]){
        if(!policy.memberships.some(item=>item.principalId===principalId&&item.audience===audience&&item.contextId===contextId))
          policy.memberships.push({principalId,audience,contextId,status:'active'});
        policy.assignments.push({principalId,audience,contextId,roleId});
      }
      good(await acl.replacePolicy(admin.token,{expectedEpoch:before.epoch,policy}));
      const apiToken=good(await machines.issueToken(admin.token,{principalId:machine.id,label:'stripe read test',
        ttlMs:60000,scopes:[{contextId:'application',audience:'admin',permissionIds:[`${moduleId}:read`]}]})).token;
      const keyring=createVaultKeyring({activeKeyId:'stripe-test',keys:{'stripe-test':new Uint8Array(32).fill(23)}});
      const requests=[];
      let pauseCustomer=null;
      const fetcher=async(url,init)=>{
        const parsed=new URL(url),credential=init.headers.get('Authorization');
        requests.push({url:String(url),method:init.method,redirect:init.redirect,credential,
          apiVersion:init.headers.get('Stripe-Version')});
        const account=credential==='Bearer synthetic-key-two'?'account-two':'account-one';
        if(parsed.pathname==='/v1/customers'){
          if(pauseCustomer){const pause=pauseCustomer;pauseCustomer=null;pause.enter();await pause.releasePromise;}
          const after=parsed.searchParams.get('starting_after');
          if(account==='account-two'){
            const all=Array.from({length:27},(_,index)=>customer(`cus_${String(index).padStart(3,'0')}`,account));
            const start=after?all.findIndex(row=>row.id===after)+1:0;
            const count=Number(parsed.searchParams.get('limit'));
            return Response.json({object:'list',data:all.slice(start,start+count),has_more:start+count<all.length});
          }
          if(after)return Response.json({object:'list',data:[customer('cus_3',account)],has_more:false});
          const count=Number(parsed.searchParams.get('limit'));
          return Response.json({object:'list',data:count===1?[customer('cus_1',account)]:
            [customer('cus_1',account),customer('cus_2',account)],has_more:count!==1});
        }
        if(parsed.pathname==='/v1/subscriptions')return Response.json({object:'list',data:[],has_more:false});
        if(parsed.pathname==='/v1/invoices')return Response.json({object:'list',data:[],has_more:false});
        return new Response(null,{status:404});
      };
      const registered=registry(),engine=createOperationEngine({db,catalog,registry:registered,permissions,
        connectors:[{descriptor:stripeConnectorDescriptor,keyring,fetcher}]});
      const invoke=(operationId,input,{token=admin.token,audience='admin',contextId='application',kind='session'}={})=>
        engine.invoke({credential:{kind,token},moduleId,operationId,contextId,audience,input});
      const lookup=(operationId,requestKey)=>engine.lookup({credential:{kind:'session',token:admin.token},
        moduleId,operationId,contextId:'application',audience:'admin',requestKey});
      const configured=success(await invoke('config.set',{requestKey:'config-create',enabled:false,revision:0})).config;
      assert.equal(configured.revision,1);
      const keyed=success(await invoke('config.key.set',{requestKey:'key-one',apiKey:'synthetic-key-one',revision:1})).config;
      assert.equal(keyed.revision,2);assert.equal(keyed.hasKey,true);
      const secretRow=await db.prepare(`SELECT ciphertext FROM "${generated.tables.connector_secret}" WHERE context_id=?`)
        .bind('application').first();
      assert.doesNotMatch(JSON.stringify(secretRow),/synthetic-key-one/u);
      const enabled=success(await invoke('config.set',{requestKey:'enable-one',enabled:true,revision:2})).config;
      assert.equal(enabled.enabled,true);
      assert.equal(success(await invoke('connection.check',{})).reachable,true);
      const twoStarts=await Promise.allSettled([
        invoke('sync.start',{requestKey:'start-a',collection:'customers',runId:'run-a',revision:0}),
        invoke('sync.start',{requestKey:'start-b',collection:'customers',runId:'run-b',revision:0})]);
      assert.equal(twoStarts.filter(row=>row.status==='fulfilled'&&row.value.execution?.state==='succeeded').length,1);
      const startReceipts=await Promise.all(['start-a','start-b'].map(key=>lookup('sync.start',key)));
      assert.equal(startReceipts.filter(row=>row?.state==='succeeded').length,1,
        'two simultaneous starts never confirm incompatible runs');
      const state=success(await invoke('sync.state',{})).states.find(row=>row.collection==='customers');
      assert.equal(state.revision,1);
      await failed(invoke('sync.start',{requestKey:'stale-start',collection:'customers',
        runId:'stale-run',revision:0}),'conflict');
      const twoPages=await Promise.allSettled([
        invoke('sync.page',{requestKey:'page-a',collection:'customers',runId:state.runId,cursor:null,
          expectedRevision:1,limit:8}),
        invoke('sync.page',{requestKey:'page-b',collection:'customers',runId:state.runId,cursor:null,
          expectedRevision:1,limit:8})]);
      assert.equal(twoPages.filter(row=>row.status==='fulfilled'&&row.value.execution?.state==='succeeded').length,1);
      const pageReceipts=await Promise.all(['page-a','page-b'].map(key=>lookup('sync.page',key)));
      assert.equal(pageReceipts.filter(row=>row?.state==='succeeded').length,1,
        'two simultaneous pages never advance twice');
      const first=success(twoPages.find(row=>row.status==='fulfilled'&&
        row.value.execution?.state==='succeeded').value);
      assert.equal(first.processed,2);assert.equal(first.state.cursor,'cus_2');
      await failed(invoke('sync.page',{requestKey:'stale-page',collection:'customers',runId:state.runId,
        cursor:null,expectedRevision:1,limit:8}),'conflict');
      const pageTwo=success(await invoke('sync.page',{requestKey:'page-two',collection:'customers',
        runId:state.runId,cursor:'cus_2',expectedRevision:2,limit:8}));
      assert.equal(pageTwo.processed,1);assert.equal(pageTwo.state.status,'pages_exhausted');
      const listed=success(await invoke('customer.list',{limit:25}));
      assert.deepEqual(listed.items.map(row=>row.id),['cus_1','cus_2','cus_3']);
      assert.doesNotMatch(JSON.stringify(listed),/not-projected|never-expose|metadata|email/u);
      const other=success(await invoke('customer.list',{limit:25},{contextId:'other'}));
      assert.deepEqual(other.items,[]);
      await failed(invoke('customer.list',{limit:25},{token:app.token,audience:'app'}),'forbidden');
      await failed(invoke('config.set',{requestKey:'machine-write',enabled:false,revision:3},
        {token:apiToken,kind:'api-token'}),'forbidden');
      assert.ok(requests.every(row=>row.method==='GET'&&row.redirect==='manual'&&
        row.url.startsWith('https://api.stripe.com/v1/')&&row.apiVersion==='2026-08-26.dahlia'));
      assert.ok(requests.every(row=>row.credential==='Bearer synthetic-key-one'));
      const httpBindings=compileHttpBindings({composition,modules:[manifest],operationCatalog:registered.catalog});
      const http=createOperationHttpTransport(httpBindings,engine),origin='https://creezio.example.invalid';
      const wire=path=>http.dispatch(new Request(origin+path,{headers:{authorization:`Bearer ${apiToken}`,
        'x-creezio-context':'application'}}),{profile:'sites',bindings:{DB:db}},
        {CREEZIO_APP_ORIGIN:origin},'stripe-http');
      const httpRead=await wire('/api/admin/stripe/customer/list?limit=25');
      assert.equal(httpRead.status,200,await httpRead.clone().text());
      assert.equal((await httpRead.json()).execution.output.items.length,3);
      assert.equal((await wire('/api/admin/stripe/config/read')).status,403);
      const widgetCatalog=compileWidgetCatalog({composition,modules:[manifest],
        operationCatalog:registered.catalog,
        readAsset:(_id,relative)=>readFileSync(new URL(`../../extensions/connectors/stripe/${relative}`,
          import.meta.url),'utf8'),
        bundleRenderer:(_id,reference)=>buildSync({entryPoints:[fileURLToPath(new URL(
          `../../extensions/connectors/stripe/${reference.path}`,import.meta.url))],bundle:true,
          write:false,platform:'browser',format:'iife',globalName:'__creezioWidget',target:'es2022',
          minify:true,footer:{js:`__creezioWidget.${reference.export}();`}}).outputFiles[0].text});
      const mcpBindings=compileMcpBindings({composition,modules:[manifest],
        operationCatalog:registered.catalog,widgetCatalog});
      const mcp=createMcpHttpTransport(mcpBindings,registered,engine,{origin,
        resourceMetadataUrl:audience=>`${origin}/.well-known/oauth-protected-resource/mcp/${audience}`,
        authenticate:async(request,audience)=>{
          const token=request.headers.get('authorization')?.replace(/^Bearer /u,'');
          const checked=await machines.check(token,{contextId:'application',audience,actors:['machine'],
            requiredPermissionIds:[`${moduleId}:read`],purpose:'operation'});
          return checked.allowed?{credential:{kind:'api-token',token},contextId:'application'}:null;
        },canDiscover:async(identity,target)=>(await machines.check(identity.credential.token,{
          contextId:target.contextId,audience:target.audience,actors:target.actors,
          requiredPermissionIds:target.permissionIds,purpose:'operation'})).allowed});
      mcpClient=new Client({name:'stripe-integration',version:'1.0.0'});
      await mcpClient.connect(new StreamableHTTPClientTransport(new URL(origin+'/mcp/admin'),{
        authProvider:{token:async()=>apiToken},fetch:(input,init)=>mcp.dispatch(new Request(input,init),'admin','stripe-mcp')}));
      assert.ok((await mcpClient.listTools()).tools.some(tool=>tool.name==='stripe_customer_list'));
      const mcpRead=await mcpClient.callTool({name:'stripe_customer_list',arguments:{limit:25}});
      assert.equal(mcpRead.structuredContent.items.length,3);
      success(await invoke('sync.start',{requestKey:'race-start',collection:'customers',
        runId:'race-run',revision:3}));
      let enter,release;
      const entered=new Promise(resolve=>{enter=resolve;});
      const releasePromise=new Promise(resolve=>{release=resolve;});
      pauseCustomer={enter,releasePromise};
      const racingPage=invoke('sync.page',{requestKey:'page-at-rotation',collection:'customers',
        runId:'race-run',cursor:null,expectedRevision:4,limit:8});
      await entered;
      const rotated=success(await invoke('config.key.set',{requestKey:'key-two',apiKey:'synthetic-key-two',
        revision:3})).config;
      release();
      const raceResult=await racingPage.catch(error=>error);
      assert.notEqual(raceResult.execution?.state,'succeeded',
        'a page cannot commit old-generation rows after a key rotation');
      const racedReceipt=await lookup('sync.page','page-at-rotation');
      assert.notEqual(racedReceipt?.state,'succeeded');
      const stateRow=await db.prepare(`SELECT revision,cursor FROM "${generated.tables.sync_state}" WHERE context_id=? AND id=?`)
        .bind('application','customers').first();
      assert.equal(stateRow.revision,4);assert.equal(stateRow.cursor,null);
      assert.equal(rotated.enabled,false);
      assert.deepEqual(success(await invoke('customer.list',{limit:25})).items,[],
        'old-account projections are hidden immediately after rotation');
      assert.equal(success(await invoke('sync.state',{})).states[0].runId,null);
      await failed(invoke('sync.page',{requestKey:'old-page',collection:'customers',runId:'race-run',
        cursor:null,expectedRevision:4,limit:8}),'conflict');
      success(await invoke('config.set',{requestKey:'enable-two',enabled:true,revision:4}));
      const fresh=success(await invoke('sync.start',{requestKey:'new-start',collection:'customers',
        runId:'new-run',revision:4})).state;
      assert.equal(fresh.runId,'new-run');
      let current=fresh,pagesRead=0;
      while(current.status==='partial'){
        current=success(await invoke('sync.page',{requestKey:`new-page-${pagesRead}`,collection:'customers',
          runId:'new-run',cursor:current.cursor,expectedRevision:current.revision,limit:8})).state;
        pagesRead++;
        assert.ok(pagesRead<=4);
      }
      assert.equal(pagesRead,4);
      const listOne=success(await invoke('customer.list',{limit:25}));
      assert.equal(listOne.items.length,25);assert.ok(listOne.nextCursor);
      const listTwo=success(await invoke('customer.list',{limit:25,cursor:listOne.nextCursor}));
      assert.equal(listTwo.items.length,2);assert.equal(listTwo.nextCursor,null);
      assert.deepEqual([...listOne.items,...listTwo.items].map(row=>row.name),
        Array.from({length:27},(_,index)=>`account-two-cus_${String(index).padStart(3,'0')}`));
      const egressBeforeRevoke=requests.length;
      const revoked=success(await invoke('config.key.revoke',{requestKey:'revoke-two',revision:5})).config;
      assert.equal(revoked.hasKey,false);assert.equal(revoked.enabled,false);
      assert.deepEqual(success(await invoke('customer.list',{limit:25})).items,[]);
      await failed(invoke('connection.check',{}),'unavailable');
      assert.equal(requests.length,egressBeforeRevoke,'revoked connection cannot issue a GET');
    }finally{if(mcpClient)await mcpClient.close();await runtime.dispose();}
  });
