import '../../scripts/local-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
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
import {createWebhookProofAuthority} from '../../core/connectors/webhook-proof.ts';
import {createSignedWebhookBridge} from '../../core/connectors/webhook-http.ts';
import {createVaultedWebhookResolver} from '../../core/connectors/webhook-resolver.ts';
import {stripeWebhookInput} from '../../extensions/connectors/stripe/module/webhook.ts';
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
  audiences:item.audiences,actors:item.actors.filter(actor=>actor!=='signed-webhook')}));
const catalog={schemaVersion:1,compositionDigest:digest,modules:[{moduleId,version:manifest.identity.version,
  enabled:true,permissions:manifest.contracts.permissions,models:manifest.contracts.models.map(model=>({
    modelId:model.id,table:generated.tables[model.id],model}))}]};
const composition={modules:[{moduleId,enabled:true}],exposure:{admin:{moduleIds:[moduleId]},app:{moduleIds:[moduleId]}}};
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

test('Stripe connector commits pages and cancellation changes atomically in D1 with scoped access',
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
        permissionOverrides:[]},{id:'stripe-buyer',inherits:[],
        permissionIds:[`${moduleId}:purchase`,`${moduleId}:purchase.read`],
        permissionOverrides:[]},{id:'stripe-webhook',inherits:[],
        permissionIds:[`${moduleId}:read`,`${moduleId}:webhook.receive`],permissionOverrides:[]});
      policy.contexts.push({id:'other',status:'active'});
      for(const [principalId,audience,contextId,roleId] of [[owner.principalId,'admin','application','stripe-admin'],
        [owner.principalId,'app','application','stripe-buyer'],
        [owner.principalId,'admin','other','stripe-reader'],[machine.id,'admin','application','stripe-webhook']]){
        if(!policy.memberships.some(item=>item.principalId===principalId&&item.audience===audience&&item.contextId===contextId))
          policy.memberships.push({principalId,audience,contextId,status:'active'});
        policy.assignments.push({principalId,audience,contextId,roleId});
      }
      good(await acl.replacePolicy(admin.token,{expectedEpoch:before.epoch,policy}));
      const apiToken=good(await machines.issueToken(admin.token,{principalId:machine.id,label:'stripe read test',
        ttlMs:60000,scopes:[{contextId:'application',audience:'admin',permissionIds:[`${moduleId}:read`]}]})).token;
      const serviceToken=good(await machines.issueToken(admin.token,{principalId:machine.id,label:'stripe webhook test',
        ttlMs:60000,scopes:[{contextId:'application',audience:'admin',
          permissionIds:[`${moduleId}:webhook.receive`]}]})).token;
      const keyring=createVaultKeyring({activeKeyId:'stripe-test',keys:{'stripe-test':new Uint8Array(32).fill(23)}});
      const requests=[];
      let pauseCustomer=null,checkoutCount=0,rotateOnCheckout=false,rotateCheckout;
      let subscriptionWrites=0,failNextSubscription=false,planWrites=0,failNextPlan=false;
      const fetcher=async(url,init)=>{
        const parsed=new URL(url),credential=init.headers.get('Authorization');
        requests.push({url:String(url),method:init.method,redirect:init.redirect,credential,
          apiVersion:init.headers.get('Stripe-Version'),idempotencyKey:init.headers.get('Idempotency-Key')});
        if(parsed.pathname==='/v1/checkout/sessions'&&init.method==='POST'){
          checkoutCount++;
          if(rotateOnCheckout)await rotateCheckout();
          const form=new URLSearchParams(init.body);
          return Response.json({id:`cs_test_${checkoutCount}`,object:'checkout.session',
            livemode:false,mode:form.get('mode'),status:'open',payment_status:'unpaid',
            url:`https://checkout.stripe.com/c/test_${checkoutCount}`,
            client_reference_id:form.get('client_reference_id')});
        }
        if(parsed.pathname.startsWith('/v1/checkout/sessions/cs_test_')&&init.method==='GET'){
          const id=parsed.pathname.split('/').at(-1);
          return Response.json({id,object:'checkout.session',livemode:false,
            mode:'subscription',status:'open',payment_status:'unpaid',
            url:`https://checkout.stripe.com/c/test_${id.slice(8)}`});
        }
        if(parsed.pathname==='/v1/subscriptions/sub_test'&&init.method==='POST'){
          subscriptionWrites++;
          if(failNextSubscription){failNextSubscription=false;return Response.json({error:'uncertain'},
            {status:500});}
          const cancel=new URLSearchParams(init.body).get('cancel_at_period_end');
          return Response.json({id:'sub_test',object:'subscription',livemode:false,
            customer:'cus_test',status:'active',cancel_at_period_end:cancel==='true'});
        }
        if(parsed.pathname==='/v1/subscriptions/sub_plan'&&init.method==='POST'){
          planWrites++;
          if(failNextPlan){failNextPlan=false;return Response.json({error:'uncertain'},{status:500});}
          const form=new URLSearchParams(init.body);
          assert.equal(form.get('proration_behavior'),'none');
          assert.equal(form.get('payment_behavior'),'error_if_incomplete');
          assert.equal(form.get('items[0][id]'),'si_plan');
          assert.equal(form.get('items[0][price]'),'price_active');
          return Response.json({id:'sub_plan',object:'subscription',livemode:false,
            customer:'cus_test',status:'active',cancel_at_period_end:false,pending_update:null,
            items:{has_more:false,data:[{id:'si_plan',quantity:Number(form.get('items[0][quantity]')),
              price:{id:'price_active',unit_amount:1299,currency:'eur',
                recurring:{interval:'month',interval_count:1}}}]}});
        }
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
        if(parsed.pathname==='/v1/products')return Response.json({object:'list',data:[{
          id:'prod_catalog',object:'product',name:'Catalogue témoin',active:true,livemode:false,
          default_price:'price_active',metadata:{secret:'excluded'}}],has_more:false});
        if(parsed.pathname==='/v1/prices'){
          const active=parsed.searchParams.get('active');
          if(active!=='true'&&active!=='false')return new Response(null,{status:400});
          return Response.json({object:'list',data:[{id:active==='true'?'price_active':'price_inactive',
            object:'price',product:'prod_catalog',active:active==='true',livemode:false,
            currency:'eur',type:'recurring',billing_scheme:'per_unit',unit_amount:1299,
            unit_amount_decimal:'1299',recurring:{interval:'month',interval_count:1,usage_type:'licensed'},
            tiers_mode:null,custom_unit_amount:null,metadata:{secret:'excluded'}}],has_more:false});
        }
        return new Response(null,{status:404});
      };
      const registered=registry(),proof=createWebhookProofAuthority(),engine=createOperationEngine({
        db,catalog,registry:registered,permissions,webhooks:proof,
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
      for(const collection of ['products','prices_active','prices_inactive']){
        const state=success(await invoke('sync.start',{requestKey:`start-${collection}`,
          collection,runId:`run-${collection}`,revision:0})).state;
        const pageResult=await invoke('sync.page',{requestKey:`page-${collection}`,collection,
          runId:state.runId,cursor:null,expectedRevision:state.revision,limit:8});
        assert.equal(pageResult.execution?.state,'succeeded',
          `${collection}: ${pageResult.execution?.errorCode}; ${requests.at(-1)?.url}`);
        const page=success(pageResult);
        assert.equal(page.processed,1);assert.equal(page.state.status,'pages_exhausted');
      }
      const productRows=success(await invoke('product.list',{limit:25})).items;
      const priceRows=success(await invoke('price.list',{limit:25})).items;
      assert.deepEqual(productRows.map(row=>row.id),['prod_catalog']);
      assert.deepEqual(priceRows.map(row=>[row.id,row.product_id,row.active]),[
        ['price_active','prod_catalog',true],['price_inactive','prod_catalog',false]]);
      assert.doesNotMatch(JSON.stringify({productRows,priceRows}),/excluded|metadata/u);
      assert.deepEqual(success(await invoke('product.list',{limit:25},{contextId:'other'})).items,[]);
      assert.equal(success(await invoke('sync.state',{})).states.length,6);
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
      const appWire=path=>http.dispatch(new Request(origin+path,{headers:{
        cookie:`__Host-creezio-app=${app.token}`,'x-creezio-context':'application'}}),
      {profile:'sites',bindings:{DB:db}},{CREEZIO_APP_ORIGIN:origin},'stripe-app-http');
      const httpRead=await wire('/api/admin/stripe/customer/list?limit=25');
      assert.equal(httpRead.status,200,await httpRead.clone().text());
      assert.equal((await httpRead.json()).execution.output.items.length,3);
      const productHttp=await wire('/api/admin/stripe/product/list?limit=25');
      assert.equal(productHttp.status,200,await productHttp.clone().text());
      assert.equal((await productHttp.json()).execution.output.items[0].id,'prod_catalog');
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
      assert.ok((await mcpClient.listTools()).tools.some(tool=>tool.name==='stripe_price_list'));
      const mcpPrice=await mcpClient.callTool({name:'stripe_price_list',arguments:{limit:25}});
      assert.equal(mcpPrice.structuredContent.items.length,2);
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
      assert.deepEqual(success(await invoke('product.list',{limit:25})).items,[]);
      assert.deepEqual(success(await invoke('price.list',{limit:25})).items,[]);
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
      const tested=success(await invoke('config.key.set',{requestKey:'key-three',
        apiKey:'sk_test_example_key_three',revision:6})).config;
      const checkoutReady=success(await invoke('config.set',{requestKey:'enable-three',enabled:true,
        checkoutReturnOrigin:'https://app.example.test',revision:tested.revision})).config;
      assert.equal(checkoutReady.revision,8);
      const currentConnection=await db.prepare(`SELECT connection_id FROM "${generated.tables.connector_config}"
        WHERE context_id=? AND id=?`).bind('application','stripe.api.v1').first();
      await db.prepare(`INSERT INTO "${generated.tables.stripe_subscription}"
        (context_id,id,connection_id,customer_id,status,cancel_at_period_end,period_end_at,
          livemode,revision,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
        .bind('application','sub_test',currentConnection.connection_id,'cus_test','active',0,
          '2099-01-01T00:00:00.000Z',0,1,new Date().toISOString()).run();
      const cancelInput={requestKey:'cancel-set-true',subscriptionId:'sub_test',revision:1,
        cancelAtPeriodEnd:true};
      assert.equal(success(await invoke('subscription.cancel.set',cancelInput)).cancelAtPeriodEnd,true);
      assert.equal(subscriptionWrites,1);
      assert.equal((await db.prepare(`SELECT cancel_at_period_end,revision FROM
        "${generated.tables.stripe_subscription}" WHERE context_id=? AND id=?`)
        .bind('application','sub_test').first()).revision,2);
      const cancelReplay=await invoke('subscription.cancel.set',cancelInput);
      assert.equal(cancelReplay.replayed,true);assert.equal(subscriptionWrites,1);
      await failed(invoke('subscription.cancel.set',{...cancelInput,requestKey:'cancel-stale'}),'conflict');
      await failed(invoke('subscription.cancel.set',{...cancelInput,requestKey:'cancel-foreign'},
        {contextId:'other'}),'forbidden');
      await assert.rejects(invoke('subscription.cancel.set',{...cancelInput,
        requestKey:'cancel-webhook-machine'},{token:serviceToken,kind:'api-token'}),
      {code:'forbidden'});
      assert.equal(subscriptionWrites,1);
      assert.equal(success(await invoke('subscription.cancel.set',{requestKey:'cancel-set-false',
        subscriptionId:'sub_test',revision:2,cancelAtPeriodEnd:false})).cancelAtPeriodEnd,false);
      assert.equal(subscriptionWrites,2);
      const resumed=await db.prepare(`SELECT cancel_at_period_end,revision FROM
        "${generated.tables.stripe_subscription}" WHERE context_id=? AND id=?`)
        .bind('application','sub_test').first();
      assert.equal(resumed.cancel_at_period_end,0);assert.equal(resumed.revision,3);
      failNextSubscription=true;
      const uncertainCancel=await invoke('subscription.cancel.set',{requestKey:'cancel-unknown',
        subscriptionId:'sub_test',revision:3,cancelAtPeriodEnd:true}).catch(error=>error);
      assert.notEqual(uncertainCancel.execution?.state,'succeeded');
      assert.equal((await lookup('subscription.cancel.set','cancel-unknown'))?.state,'unknown');
      const writesAfterUnknown=subscriptionWrites;
      const replayUnknown=await invoke('subscription.cancel.set',{requestKey:'cancel-unknown',
        subscriptionId:'sub_test',revision:3,cancelAtPeriodEnd:true});
      assert.equal(replayUnknown.replayed,true);assert.equal(subscriptionWrites,writesAfterUnknown);
      const priceRun=success(await invoke('sync.start',{requestKey:'price-three-start',
        collection:'prices_active',runId:'price-three',revision:2})).state;
      success(await invoke('sync.page',{requestKey:'price-three-page',collection:'prices_active',
        runId:'price-three',cursor:null,expectedRevision:priceRun.revision,limit:8}));
      await db.prepare(`INSERT INTO "${generated.tables.stripe_subscription}"
        (context_id,id,connection_id,customer_id,status,cancel_at_period_end,item_id,price_id,
          unit_amount_minor,currency,interval,interval_count,quantity,period_end_at,
          livemode,revision,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .bind('application','sub_plan',currentConnection.connection_id,'cus_test','active',0,
          'si_plan','price_old',100,'EUR','month',1,1,'2099-01-01T00:00:00.000Z',0,1,
          new Date().toISOString()).run();
      const planInput={requestKey:'plan-one',subscriptionId:'sub_plan',revision:1,
        priceId:'price_active',quantity:2};
      assert.equal(success(await invoke('subscription.plan.set',planInput)).prorationBehavior,'none');
      assert.equal(planWrites,1);
      const updatedPlan=await db.prepare(`SELECT item_id,price_id,quantity,revision FROM
        "${generated.tables.stripe_subscription}" WHERE context_id=? AND id=?`)
        .bind('application','sub_plan').first();
      assert.deepEqual([updatedPlan.item_id,updatedPlan.price_id,updatedPlan.quantity,
        updatedPlan.revision],['si_plan','price_active',2,2]);
      assert.equal((await invoke('subscription.plan.set',planInput)).replayed,true);
      assert.equal(planWrites,1);
      await failed(invoke('subscription.plan.set',{...planInput,requestKey:'plan-stale'}),'conflict');
      await failed(invoke('subscription.plan.set',{...planInput,requestKey:'plan-foreign'},
        {contextId:'other'}),'forbidden');
      failNextPlan=true;
      const uncertainPlan={...planInput,requestKey:'plan-unknown',revision:2,quantity:3};
      await failed(invoke('subscription.plan.set',uncertainPlan),'unknown');
      assert.equal((await lookup('subscription.plan.set','plan-unknown'))?.state,'unknown');
      assert.equal((await invoke('subscription.plan.set',uncertainPlan)).replayed,true);
      assert.equal(planWrites,2);
      const checkoutInput={requestKey:'checkout-one',priceId:'price_active',quantity:1};
      const checkoutResult=await invoke('checkout.subscription.create',checkoutInput);
      assert.equal(checkoutResult.execution.state,'succeeded');
      assert.equal(checkoutResult.execution.output.session.id,'cs_test_1');
      assert.equal(checkoutCount,1);
      const savedCheckout=await db.prepare(`SELECT id,mode,livemode FROM "${generated.tables.stripe_checkout}" WHERE context_id=? AND id=?`)
        .bind('application','cs_test_1').first();
      assert.equal(savedCheckout.mode,'subscription');assert.equal(savedCheckout.livemode,0);
      const replayCheckout=await invoke('checkout.subscription.create',checkoutInput);
      assert.equal(replayCheckout.replayed,true);assert.equal(checkoutCount,1);
      const productRun=success(await invoke('sync.start',{requestKey:'product-three-start',
        collection:'products',runId:'product-three',revision:2})).state;
      success(await invoke('sync.page',{requestKey:'product-three-page',collection:'products',
        runId:'product-three',cursor:null,expectedRevision:productRun.revision,limit:8}));
      const offerPriceRow=await db.prepare(`SELECT connection_id,product_id,active,livemode,
        unit_amount_minor,currency FROM "${generated.tables.stripe_price}" WHERE context_id=? AND id=?`)
        .bind('application','price_active').first();
      const offerProductRow=await db.prepare(`SELECT connection_id,active,livemode FROM
        "${generated.tables.stripe_product}" WHERE context_id=? AND id=?`)
        .bind('application','prod_catalog').first();
      assert.equal(offerPriceRow.connection_id,currentConnection.connection_id);
      assert.equal(offerProductRow.connection_id,currentConnection.connection_id);
      assert.equal(offerPriceRow.product_id,'prod_catalog');
      assert.equal(offerPriceRow.unit_amount_minor,1299);
      assert.equal(offerPriceRow.currency,'EUR');
      assert.equal(offerPriceRow.active,1);assert.equal(offerProductRow.active,1);
      assert.equal(offerPriceRow.livemode,0);assert.equal(offerProductRow.livemode,0);
      const offerConfigRow=await db.prepare(`SELECT connection_id,revision,enabled FROM
        "${generated.tables.connector_config}" WHERE context_id=? AND id=?`)
        .bind('application','stripe.api.v1').first();
      assert.equal(offerConfigRow.connection_id,currentConnection.connection_id);
      assert.equal(offerConfigRow.revision,8);assert.equal(offerConfigRow.enabled,1);
      const offer=success(await invoke('offer.set',{requestKey:'offer-create',
        productId:'prod_catalog',priceId:'price_active',enabled:true,revision:0})).offer;
      assert.equal(offer.mode,'subscription');assert.equal(offer.unitAmountMinor,1299);
      assert.equal(success(await invoke('offer.list',{limit:8})).items[0].id,offer.id);
      const appOptions={token:app.token,audience:'app'};
      assert.equal(success(await invoke('app.offer.list',{limit:8},appOptions)).items[0].id,offer.id);
      const appHttpOffers=await appWire('/api/app/stripe/offer/list?limit=8');
      assert.equal(appHttpOffers.status,200,await appHttpOffers.clone().text());
      assert.equal((await appHttpOffers.json()).execution.output.items[0].id,offer.id);
      const offerIds=new Set([offer.id]);
      for(let index=1;index<8;index++){
        const extra=success(await invoke('offer.set',{requestKey:`offer-create-${index}`,
          productId:'prod_catalog',priceId:'price_active',enabled:true,revision:0})).offer;
        offerIds.add(extra.id);
      }
      assert.equal(offerIds.size,8);
      const fullPage=success(await invoke('app.offer.list',{limit:8},appOptions));
      assert.equal(fullPage.items.length,8,'a full app page stays within the operation read budget');
      assert.deepEqual(new Set(fullPage.items.map(item=>item.id)),offerIds);
      await failed(invoke('app.checkout.create',{requestKey:'app-invalid',offerId:offer.id,
        priceId:'price_inactive'},appOptions),'invalid_input');
      const appInput={requestKey:'app-buy-one',offerId:offer.id};
      const appCheckout=success(await invoke('app.checkout.create',appInput,appOptions));
      assert.equal(appCheckout.session.id,'cs_test_2');assert.equal(appCheckout.productId,'prod_catalog');
      assert.equal(checkoutCount,2);
      const appRow=await db.prepare(`SELECT owner_principal_id,offer_id,offer_revision,quantity
        FROM "${generated.tables.stripe_checkout}" WHERE context_id=? AND id=?`)
        .bind('application','cs_test_2').first();
      assert.equal(appRow.owner_principal_id,owner.principalId);
      assert.equal(appRow.offer_id,offer.id);assert.equal(appRow.offer_revision,1);
      assert.equal(appRow.quantity,1);
      assert.equal((await invoke('app.checkout.create',appInput,appOptions)).replayed,true);
      assert.equal(checkoutCount,2);
      assert.equal(success(await invoke('app.checkout.read',{sessionId:'cs_test_2'},appOptions))
        .session.id,'cs_test_2');
      const appHttpRead=await appWire('/api/app/stripe/checkout/read?session_id=cs_test_2');
      assert.equal(appHttpRead.status,200,await appHttpRead.clone().text());
      assert.equal((await appHttpRead.json()).execution.output.session.id,'cs_test_2');
      await failed(invoke('app.checkout.read',{sessionId:'cs_test_1'},appOptions),'not_found');
      const appHttpForeign=await appWire('/api/app/stripe/checkout/read?session_id=cs_test_1');
      assert.equal(appHttpForeign.status,200);
      assert.equal((await appHttpForeign.json()).execution.errorCode,'not_found');
      await failed(invoke('app.checkout.create',{requestKey:'admin-cannot-buy',offerId:offer.id}),
        'forbidden');
      rotateCheckout=()=>invoke('config.set',{requestKey:'disable-during-checkout',
        enabled:false,revision:checkoutReady.revision});
      rotateOnCheckout=true;
      const uncertain=await invoke('checkout.subscription.create',{requestKey:'checkout-race',
        priceId:'price_active',quantity:1}).catch(error=>error);
      assert.notEqual(uncertain.execution?.state,'succeeded');
      const receipt=await lookup('checkout.subscription.create','checkout-race');
      assert.equal(receipt?.state,'unknown');
      const egressAfterRace=checkoutCount;
      const repeated=await invoke('checkout.subscription.create',{requestKey:'checkout-race',
        priceId:'price_active',quantity:1});
      assert.equal(repeated.replayed,true);assert.equal(checkoutCount,egressAfterRace);
      const reenabled=success(await invoke('config.set',{requestKey:'webhook-enable',
        enabled:true,revision:9})).config;
      const signed=success(await invoke('config.key.webhook.set',{requestKey:'webhook-signing',
        webhookSecret:'whsec_synthetic_signing_secret_123456789',revision:reenabled.revision})).config;
      const serviced=success(await invoke('config.key.webhook.service.set',{requestKey:'webhook-service',
        serviceToken,revision:signed.revision})).config;
      const resolver=createVaultedWebhookResolver({db,catalog,keyring,contextId:'application',
        connectors:[stripeConnectorDescriptor],mappings:[{moduleId,operationId:'event.receive',
          path:'/api/webhooks/stripe',map:stripeWebhookInput}]});
      const binding={moduleId,operationId:'event.receive',path:'/api/webhooks/stripe',
        audience:'admin',auth:['webhook-signature']};
      const snapshot=await resolver(binding);
      assert.equal(snapshot?.serviceToken,serviceToken);
      const eventInput={requestKey:'evt_test_race',eventId:'evt_test_race',
        bodyDigest:'a'.repeat(64),type:'checkout.session.completed',objectId:'cs_test_1',
        livemode:false,sessionMode:'subscription',sessionStatus:'complete',paymentStatus:'paid'};
      const raceProof=await proof.issue({moduleId,operationId:'event.receive',
        contextId:'application',audience:'admin',token:serviceToken,
        eventId:eventInput.eventId,bodyDigest:eventInput.bodyDigest,
        guards:snapshot.guards,operationInput:eventInput});
      await assert.rejects(engine.invoke({credential:{kind:'api-token',token:serviceToken},
        moduleId,operationId:'event.receive',contextId:'application',audience:'admin',
        input:eventInput}),{code:'forbidden'},'the service token alone cannot invoke signed ingress');
      await assert.rejects(engine.invoke({credential:{kind:'api-token',token:serviceToken},
        moduleId,operationId:'checkout.payment.create',contextId:'application',audience:'admin',
        input:{requestKey:'webhook-must-not-checkout',priceId:'price_active',quantity:1}}),
      {code:'forbidden'},'webhook scope cannot create Checkout sessions');
      await assert.rejects(engine.invoke({credential:{kind:'api-token',token:serviceToken},
        moduleId,operationId:'event.list',contextId:'application',audience:'admin',
        input:{limit:25}}),{code:'forbidden'},'webhook scope cannot list events');
      const invalidGuardInput={...eventInput,requestKey:'evt_test_bad_guard',eventId:'evt_test_bad_guard'};
      const invalidGuardProof=await proof.issue({moduleId,operationId:'event.receive',
        contextId:'application',audience:'admin',token:serviceToken,
        eventId:invalidGuardInput.eventId,bodyDigest:invalidGuardInput.bodyDigest,
        guards:[snapshot.guards[0],{...snapshot.guards[1],modelId:'undeclared_guard'},
          ...snapshot.guards.slice(2)],operationInput:invalidGuardInput});
      const invalidGuard=await engine.invoke({credential:{kind:'api-token',token:serviceToken},
        moduleId,operationId:'event.receive',contextId:'application',audience:'admin',
        input:invalidGuardInput,webhookProof:invalidGuardProof});
      assert.equal(invalidGuard.execution.state,'failed','guard construction must settle its claim');
      assert.equal(invalidGuard.execution.errorCode,'forbidden');
      const acceptedInput={...eventInput,requestKey:'evt_test_success',eventId:'evt_test_success'};
      const acceptedProof=await proof.issue({moduleId,operationId:'event.receive',
        contextId:'application',audience:'admin',token:serviceToken,
        eventId:acceptedInput.eventId,bodyDigest:acceptedInput.bodyDigest,
        guards:snapshot.guards,operationInput:acceptedInput});
      const accepted=await engine.invoke({credential:{kind:'api-token',token:serviceToken},
        moduleId,operationId:'event.receive',contextId:'application',audience:'admin',
        input:acceptedInput,webhookProof:acceptedProof});
      assert.equal(accepted.execution.state,'succeeded',JSON.stringify(accepted.execution));
      assert.deepEqual({...accepted.execution.output},{eventId:'evt_test_success',recorded:true,
        checkoutUpdated:true});
      assert.equal(await db.prepare(`SELECT count(*) AS n FROM "${generated.tables.stripe_event}" WHERE context_id=?`)
        .bind('application').first().then(row=>row.n),1);
      const eventBody=JSON.stringify({id:'evt_test_bridge',object:'event',livemode:false,
        type:'checkout.session.completed',data:{object:{id:'cs_test_unlinked',object:'checkout.session',
          mode:'subscription',status:'complete',payment_status:'paid'}}});
      const stamp=String(Math.floor(Date.now()/1000));
      const signature=createHmac('sha256','whsec_synthetic_signing_secret_123456789')
        .update(`${stamp}.${eventBody}`).digest('hex');
      const bridge=createSignedWebhookBridge({engine,proof,resolve:resolver});
      const response=await bridge.dispatch(new Request('https://app.example.test/api/webhooks/stripe',{
        method:'POST',headers:{'content-type':'application/json',
          'stripe-signature':`t=${stamp},v1=${signature}`},body:eventBody}),binding);
      assert.equal(response.status,204,'signed bridge must commit the event');
      assert.equal(await db.prepare(`SELECT count(*) AS n FROM "${generated.tables.stripe_event}" WHERE context_id=?`)
        .bind('application').first().then(row=>row.n),2);
      const ownedBody=JSON.stringify({id:'evt_test_owned',object:'event',livemode:false,
        type:'checkout.session.completed',data:{object:{id:'cs_test_2',object:'checkout.session',
          mode:'subscription',status:'complete',payment_status:'paid',customer:'cus_app',
          subscription:'sub_app'}}});
      const ownedSignature=createHmac('sha256','whsec_synthetic_signing_secret_123456789')
        .update(`${stamp}.${ownedBody}`).digest('hex');
      const ownedResponse=await bridge.dispatch(new Request('https://app.example.test/api/webhooks/stripe',{
        method:'POST',headers:{'content-type':'application/json',
          'stripe-signature':`t=${stamp},v1=${ownedSignature}`},body:ownedBody}),binding);
      assert.equal(ownedResponse.status,204);
      const linked=await db.prepare(`SELECT owner_principal_id,customer_id,subscription_id,status,
        payment_status FROM "${generated.tables.stripe_checkout}" WHERE context_id=? AND id=?`)
        .bind('application','cs_test_2').first();
      assert.equal(linked.owner_principal_id,owner.principalId);
      assert.equal(linked.customer_id,'cus_app');assert.equal(linked.subscription_id,'sub_app');
      assert.equal(linked.status,'complete');assert.equal(linked.payment_status,'paid');
      success(await invoke('config.key.webhook.revoke',{requestKey:'webhook-revoke',
        revision:serviced.revision}));
      const racedEvent=await engine.invoke({credential:{kind:'api-token',token:serviceToken},
        moduleId,operationId:'event.receive',contextId:'application',audience:'admin',
        input:eventInput,webhookProof:raceProof}).catch(error=>error);
      assert.notEqual(racedEvent.execution?.state,'succeeded');
      assert.equal(await db.prepare(`SELECT count(*) AS n FROM "${generated.tables.stripe_event}" WHERE context_id=?`)
        .bind('application').first().then(row=>row.n),3);
    }finally{if(mcpClient)await mcpClient.close();await runtime.dispose();}
  });
