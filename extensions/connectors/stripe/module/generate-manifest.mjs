import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {stripeConnectorDescriptor} from './storage.ts';

const root=new URL('../',import.meta.url);
const template=JSON.parse(readFileSync(new URL('module/manifest.json',root),'utf8'));
const id='creezio.stripe',connectorId='stripe.api.v1',version='0.3.0',sourceRevision='t27-stripe-checkout-test-v1';
const ref=(kind,name)=>({moduleId:id,kind,id:name});
const str=(max=128,min=1)=>({type:'string',minLength:min,maxLength:max});
const integer=(min=0,max=Number.MAX_SAFE_INTEGER)=>({type:'integer',minimum:min,maximum:max});
const nullable=value=>({anyOf:[value,{type:'null'}]});
const obj=(properties,required=Object.keys(properties))=>({type:'object',properties,required,additionalProperties:false});
const array=(items,maxItems)=>({type:'array',items,maxItems});
const field=(id,type,options={})=>({id,type,nullable:options.nullable??false,
  protected:options.protected??false,computed:false,...(options.constraints?{constraints:options.constraints}:{})});
const models=[];
const model=(name,title,fields,permissions,indexes=[])=>{
  models.push({id:name,title,scope:'context',contextField:'context_id',fields:[
    field('context_id','string',{protected:true,constraints:{minLength:1,maxLength:128}}),...fields],
    primaryKey:['context_id','id'],indexes,relations:[],permissions:permissions.map(name=>ref('permission',name)),
    deletion:{mode:'soft',requiresApproval:false},public:false});
};
const idField=field('id','string',{constraints:{minLength:1,maxLength:128}});
const revisionField=field('revision','integer',{constraints:{minimum:1}});
const updatedField=field('updated_at','date-time');
model('connector_config','Configuration Stripe',[idField,
  field('origin','string',{constraints:{minLength:8,maxLength:512}}),
  field('key_ref','string',{nullable:true,constraints:{minLength:1,maxLength:128}}),
  field('secret_version','integer',{nullable:true,constraints:{minimum:1}}),
  field('connection_id','string',{nullable:true,constraints:{minLength:1,maxLength:128}}),
  field('checkout_return_origin','string',{nullable:true,constraints:{minLength:8,maxLength:512}}),
  field('webhook_key_ref','string',{nullable:true,constraints:{minLength:1,maxLength:128}}),
  field('webhook_secret_version','integer',{nullable:true,constraints:{minimum:1}}),
  field('webhook_previous_key_ref','string',{nullable:true,constraints:{minLength:1,maxLength:128}}),
  field('webhook_previous_secret_version','integer',{nullable:true,constraints:{minimum:1}}),
  field('webhook_service_token_ref','string',{nullable:true,constraints:{minLength:1,maxLength:128}}),
  field('webhook_service_token_version','integer',{nullable:true,constraints:{minimum:1}}),
  field('enabled','boolean'),revisionField,updatedField],['manage','read']);
model('connector_secret','Clé Stripe scellée',[
  field('id','string',{protected:true,constraints:{minLength:1,maxLength:128}}),
  field('binding_id','string',{protected:true,constraints:{minLength:1,maxLength:128}}),
  field('ciphertext','string',{protected:true,constraints:{minLength:1,maxLength:32768}}),
  field('key_id','string',{protected:true,constraints:{minLength:1,maxLength:128}}),
  field('version','integer',{protected:true,constraints:{minimum:1}}),
  field('state','string',{protected:true,constraints:{enum:['active','revoked']}})],['manage']);
const collections=['customers','subscriptions','invoices'];
const catalogCollections=['products','prices_active','prices_inactive'];
const allCollections=[...collections,...catalogCollections];
model('sync_state','Parcours de lecture Stripe',[field('id','string',{constraints:{enum:collections}}),
  field('run_id','string',{constraints:{minLength:1,maxLength:128}}),
  field('connection_id','string',{constraints:{minLength:1,maxLength:128}}),
  field('cursor','string',{nullable:true,constraints:{minLength:1,maxLength:128}}),
  field('status','string',{constraints:{enum:['partial','pages_exhausted']}}),revisionField,updatedField],
['manage','read']);
model('stripe_catalog_sync_state','Parcours de lecture du catalogue Stripe',[
  field('id','string',{constraints:{enum:catalogCollections}}),
  field('run_id','string',{constraints:{minLength:1,maxLength:128}}),
  field('connection_id','string',{constraints:{minLength:1,maxLength:128}}),
  field('cursor','string',{nullable:true,constraints:{minLength:1,maxLength:128}}),
  field('status','string',{constraints:{enum:['partial','pages_exhausted']}}),revisionField,updatedField],
['manage','read']);
model('stripe_customer','Client Stripe projeté',[idField,
  field('connection_id','string',{constraints:{minLength:1,maxLength:128}}),
  field('name','string',{nullable:true,constraints:{minLength:0,maxLength:160}}),
  field('livemode','boolean'),revisionField,updatedField],['manage','read'],
  [{id:'by-connection',fields:['context_id','connection_id','id'],unique:false}]);
model('stripe_subscription','Abonnement Stripe projeté',[idField,
  field('connection_id','string',{constraints:{minLength:1,maxLength:128}}),
  field('customer_id','string',{constraints:{minLength:1,maxLength:128}}),
  field('status','string',{constraints:{minLength:1,maxLength:64}}),
  field('currency','string',{nullable:true,constraints:{minLength:3,maxLength:3}}),
  field('price_id','string',{nullable:true,constraints:{minLength:1,maxLength:128}}),
  field('unit_amount_minor','integer',{nullable:true}),
  field('interval','string',{nullable:true,constraints:{minLength:1,maxLength:32}}),
  field('interval_count','integer',{nullable:true,constraints:{minimum:1}}),
  field('quantity','integer',{nullable:true,constraints:{minimum:0}}),
  field('cancel_at_period_end','boolean',{nullable:true}),
  field('period_end_at','date-time',{nullable:true}),
  field('livemode','boolean'),revisionField,updatedField],['manage','read'],
  [{id:'by-connection',fields:['context_id','connection_id','id'],unique:false}]);
model('stripe_invoice','Facture Stripe projetée',[idField,
  field('connection_id','string',{constraints:{minLength:1,maxLength:128}}),
  field('customer_id','string',{nullable:true,constraints:{minLength:1,maxLength:128}}),
  field('status','string',{nullable:true,constraints:{minLength:1,maxLength:64}}),
  field('currency','string',{constraints:{minLength:3,maxLength:3}}),
  field('amount_due_minor','integer'),
  field('period_start_at','date-time',{nullable:true}),
  field('period_end_at','date-time',{nullable:true}),
  field('livemode','boolean'),revisionField,updatedField],['manage','read'],
  [{id:'by-connection',fields:['context_id','connection_id','id'],unique:false}]);
model('stripe_product','Produit Stripe projeté',[idField,
  field('connection_id','string',{constraints:{minLength:1,maxLength:128}}),
  field('name','string',{constraints:{minLength:1,maxLength:500}}),
  field('active','boolean'),
  field('default_price_id','string',{nullable:true,constraints:{minLength:1,maxLength:128}}),
  field('livemode','boolean'),revisionField,updatedField],['manage','read'],
  [{id:'by-connection',fields:['context_id','connection_id','id'],unique:false}]);
model('stripe_price','Prix Stripe projeté',[idField,
  field('connection_id','string',{constraints:{minLength:1,maxLength:128}}),
  field('product_id','string',{constraints:{minLength:1,maxLength:128}}),
  field('active','boolean'),field('livemode','boolean'),
  field('currency','string',{constraints:{minLength:3,maxLength:3}}),
  field('type','string',{constraints:{enum:['one_time','recurring']}}),
  field('billing_scheme','string',{constraints:{enum:['per_unit','tiered']}}),
  field('unit_amount_minor','integer',{nullable:true,constraints:{minimum:0}}),
  field('unit_amount_decimal','string',{nullable:true,constraints:{minLength:1,maxLength:64}}),
  field('interval','string',{nullable:true,constraints:{minLength:1,maxLength:16}}),
  field('interval_count','integer',{nullable:true,constraints:{minimum:1}}),
  field('usage_type','string',{nullable:true,constraints:{minLength:1,maxLength:16}}),
  field('tiers_mode','string',{nullable:true,constraints:{minLength:1,maxLength:16}}),
  field('custom_amount','boolean'),revisionField,updatedField],['manage','read'],
  [{id:'by-connection',fields:['context_id','connection_id','id'],unique:false}]);
model('stripe_checkout','Session Checkout Stripe',[idField,
  field('connection_id','string',{constraints:{minLength:1,maxLength:128}}),
  field('execution_id','string',{constraints:{minLength:1,maxLength:128}}),
  field('price_id','string',{constraints:{minLength:1,maxLength:128}}),
  field('quantity','integer',{constraints:{minimum:1,maximum:100}}),
  field('mode','string',{constraints:{enum:['payment','subscription']}}),
  field('status','string',{constraints:{minLength:1,maxLength:32}}),
  field('payment_status','string',{constraints:{minLength:1,maxLength:32}}),
  field('url','string',{nullable:true,constraints:{minLength:8,maxLength:2048}}),
  field('livemode','boolean'),revisionField,updatedField],['manage','read'],
  [{id:'by-connection',fields:['context_id','connection_id','id'],unique:false}]);
model('stripe_event','Événement Stripe signé',[idField,
  field('connection_id','string',{constraints:{minLength:1,maxLength:128}}),
  field('type','string',{constraints:{minLength:1,maxLength:128}}),
  field('object_id','string',{constraints:{minLength:1,maxLength:128}}),
  field('body_digest','string',{constraints:{minLength:64,maxLength:64}}),
  field('livemode','boolean'),revisionField,updatedField],['manage','read'],
  [{id:'by-connection',fields:['context_id','connection_id','id'],unique:false}]);

const schemas=[],schema=(name,value)=>{schemas.push({id:name,schema:value});return {schemaId:name};};
const requestKey=str(128),revision=integer(0),stripeId=str(128),cursor=nullable(str(128));
const collection={type:'string',enum:allCollections},status={type:'string',enum:['partial','pages_exhausted']};
const configView=obj({origin:{const:'https://api.stripe.com'},enabled:{type:'boolean'},hasKey:{type:'boolean'},
  checkoutReturnOrigin:nullable(str(512,8)),hasWebhookSecret:{type:'boolean'},
  hasWebhookService:{type:'boolean'},
  revision,state:{type:'string',enum:['missing','configured','unverified']}});
const runView=obj({collection,runId:nullable(str(128)),cursor,status,revision,updatedAt:nullable(str(64))});
const empty=schema('empty-input',obj({}));
const configOutput=schema('config-output',obj({config:configView}));
const configSetInput=schema('config-set-input',obj({requestKey,enabled:{type:'boolean'},revision,
  checkoutReturnOrigin:nullable(str(512,8))},['requestKey','enabled','revision']));
const keySetInput=schema('config-key-set-input',obj({requestKey,apiKey:str(4096,8),revision}));
const keyRevokeInput=schema('config-key-revoke-input',obj({requestKey,revision}));
const webhookSetInput=schema('webhook-secret-set-input',obj({requestKey,webhookSecret:str(512,16),revision}));
const webhookServiceInput=schema('webhook-service-set-input',obj({requestKey,
  serviceToken:str(256,32),revision}));
const checkOutput=schema('connection-check-output',obj({reachable:{const:true}}));
const statesOutput=schema('sync-states-output',obj({states:array(runView,6)}));
const startInput=schema('sync-start-input',obj({requestKey,collection,runId:str(128),revision}));
const startOutput=schema('sync-start-output',obj({state:runView}));
const pageInput=schema('sync-page-input',obj({requestKey,collection,runId:str(128),cursor,
  expectedRevision:revision,limit:integer(1,8)}));
const pageOutput=schema('sync-page-output',obj({state:runView,processed:integer(0,8)}));
const listInput=schema('local-list-input',obj({limit:integer(1,25),cursor:stripeId},['limit']));
const customer=obj({id:stripeId,name:nullable(str(160,0)),livemode:{type:'boolean'},updated_at:str(64)});
const subscription=obj({id:stripeId,customer_id:stripeId,status:str(64),currency:nullable(str(3)),
  price_id:nullable(stripeId),unit_amount_minor:{...nullable({type:'integer'}),description:
    'Raw Stripe minor-unit amount. Interpret with currency and Stripe rules; it is not always major units divided by 100.'},
  interval:nullable(str(32)),
  interval_count:nullable(integer(1)),quantity:nullable(integer(0)),period_end_at:nullable(str(64)),
  revision,
  cancel_at_period_end:nullable({type:'boolean'}),
  livemode:{type:'boolean'},updated_at:str(64)});
const invoice=obj({id:stripeId,customer_id:nullable(stripeId),status:nullable(str(64)),currency:str(3),
  amount_due_minor:{type:'integer',description:'Raw Stripe minor-unit amount; interpret with the currency and Stripe rules, never divide every currency by 100.'},
  period_start_at:nullable(str(64)),period_end_at:nullable(str(64)),livemode:{type:'boolean'},updated_at:str(64)});
const customerOutput=schema('customer-list-output',obj({items:array(customer,25),nextCursor:cursor}));
const subscriptionOutput=schema('subscription-list-output',obj({items:array(subscription,25),nextCursor:cursor}));
const invoiceOutput=schema('invoice-list-output',obj({items:array(invoice,25),nextCursor:cursor}));
const product=obj({id:stripeId,name:str(500),active:{type:'boolean'},default_price_id:nullable(stripeId),
  livemode:{type:'boolean'},updated_at:str(64)});
const price=obj({id:stripeId,product_id:stripeId,active:{type:'boolean'},livemode:{type:'boolean'},
  currency:str(3),type:{type:'string',enum:['one_time','recurring']},
  billing_scheme:{type:'string',enum:['per_unit','tiered']},unit_amount_minor:nullable(integer(0)),
  unit_amount_decimal:nullable(str(64)),interval:nullable(str(16)),
  interval_count:nullable(integer(1)),usage_type:nullable(str(16)),tiers_mode:nullable(str(16)),
  custom_amount:{type:'boolean'},updated_at:str(64)});
const productOutput=schema('product-list-output',obj({items:array(product,25),nextCursor:cursor}));
const priceOutput=schema('price-list-output',obj({items:array(price,25),nextCursor:cursor}));
const checkout=obj({id:stripeId,url:nullable(str(2048,8)),mode:{type:'string',enum:['payment','subscription']},
  status:str(32),paymentStatus:str(32),livemode:{const:false}});
const checkoutCreateInput=schema('checkout-create-input',obj({requestKey,priceId:stripeId,
  quantity:integer(1,100),customerId:stripeId},['requestKey','priceId','quantity']));
const checkoutReadInput=schema('checkout-read-input',obj({sessionId:stripeId}));
const checkoutOutput=schema('checkout-output',obj({session:checkout}));
const cancelInput=schema('subscription-cancel-input',obj({requestKey,subscriptionId:stripeId,revision:integer(1)}));
const cancelOutput=schema('subscription-cancel-output',obj({subscriptionId:stripeId,
  cancelAtPeriodEnd:{const:true},livemode:{const:false}}));
const eventInput=schema('stripe-event-input',obj({requestKey,eventId:stripeId,bodyDigest:str(64,64),
  type:str(128),objectId:stripeId,livemode:{const:false},sessionMode:nullable({type:'string',enum:['payment','subscription']}),
  sessionStatus:nullable(str(32)),paymentStatus:nullable(str(32))}));
const eventOutput=schema('stripe-event-output',obj({eventId:stripeId,recorded:{const:true},
  checkoutUpdated:{type:'boolean'}}));
const eventRow=obj({id:stripeId,type:str(128),object_id:stripeId,body_digest:str(64,64),
  livemode:{const:false},updated_at:str(64)});
const eventListOutput=schema('stripe-event-list-output',obj({items:array(eventRow,25),nextCursor:cursor}));
const panelState=schema('stripe-panel-state',obj({sessionId:str(128),audience:{const:'admin'},contextId:str(128),
  tab:{type:'string',enum:['overview','customers','subscriptions','invoices','products','prices','checkout','settings']},
  pending:obj({sessionId:str(128),audience:{const:'admin'},contextId:str(128),bindingId:str(257),
    requestKey:str(512),intent:str(128)},['sessionId','audience','contextId','bindingId','requestKey'])},
  ['sessionId','audience','contextId','tab']));
const viewInput=schema('stripe-view-input',obj({}));

const permissions=[{id:'manage',title:'Configurer et synchroniser Stripe',audiences:['admin'],
  actors:['user','delegated-user','machine'],scopes:['stripe.manage'],context:'required',default:'deny',
  resources:models.map(model=>ref('model',model.id)),actions:['read','create','update','execute'],
  enforcement:{request:true,commit:true},public:false},
{id:'read',title:'Lire la facturation projetée',audiences:['admin'],
  actors:['user','delegated-user','machine'],scopes:['stripe.read'],context:'required',default:'deny',
  resources:['connector_config','sync_state','stripe_catalog_sync_state','stripe_customer','stripe_subscription',
    'stripe_invoice','stripe_product','stripe_price','stripe_checkout','stripe_event'].map(name=>ref('model',name)),
  actions:['read','execute'],enforcement:{request:true,commit:true},public:false},
{id:'webhook.receive',title:'Recevoir les événements Stripe signés',audiences:['admin'],
  actors:['machine'],scopes:['stripe.webhook.receive'],context:'required',default:'deny',
  resources:['connector_config','stripe_event','stripe_checkout'].map(name=>ref('model',name)),
  actions:['read','create','update','execute'],enforcement:{request:true,commit:true},public:false}];
const errors=['invalid_input','unauthorized','forbidden','not_found','conflict','rate_limited','unsupported','unavailable','unknown']
  .map(code=>({code,retryable:['rate_limited','unavailable','unknown'].includes(code),
    outcome:code==='unknown'?'unknown':'rejected'}));
const operations=[];
function operation(name,title,kind,input,output,permission,reads,writes,options={}){
  const command=kind==='command';
  operations.push({id:name,title,kind,input,output,permissions:[ref('permission',permission)],
    audiences:['admin'],actors:['user','delegated-user','machine'],context:'required',
    handler:{path:'module/operations.ts',export:options.exportName},
    effects:{reads:reads.map(name=>ref('model',name)),writes:writes.map(name=>ref('model',name)),
      emits:[],calls:[],providers:options.remote?[connectorId]:[]},errors,
    pagination:options.pagination??{mode:'none'},
    idempotency:command?{mode:'required',keyField:'requestKey',scope:'actor-context-operation',retentionSeconds:86400}:{mode:'none'},
    approval:{mode:'none'},concurrency:options.cas?{mode:'object-version',versionField:'revision'}:{mode:'none'},
    execution:{maxDurationMs:options.remote?15000:10000,maxItems:options.maxItems??8,resumable:false},
    audit:{required:true,redactFields:['apiKey','webhookSecret','serviceToken']},public:false});
}
operation('config.read','Lire la configuration Stripe','query',empty,configOutput,'manage',
  ['connector_config'],[],{exportName:'configRead'});
operation('config.set','Activer ou suspendre Stripe','command',configSetInput,configOutput,'manage',
  ['connector_config'],['connector_config'],{exportName:'configSet'});
operation('config.key.set','Enregistrer la clé Stripe','command',keySetInput,configOutput,'manage',
  ['connector_config','connector_secret'],['connector_config','connector_secret'],
  {exportName:'configKeySet',cas:true,maxItems:10});
operation('config.key.revoke','Révoquer la clé Stripe','command',keyRevokeInput,configOutput,'manage',
  ['connector_config','connector_secret'],['connector_config','connector_secret'],
  {exportName:'configKeyRevoke',cas:true,maxItems:10});
operation('config.key.webhook.set','Enregistrer le secret du webhook Stripe','command',webhookSetInput,
  configOutput,'manage',['connector_config','connector_secret'],['connector_config','connector_secret'],
  {exportName:'configWebhookSet',cas:true,maxItems:10});
operation('config.key.webhook.revoke','Révoquer le secret du webhook Stripe','command',keyRevokeInput,
  configOutput,'manage',['connector_config','connector_secret'],['connector_config','connector_secret'],
  {exportName:'configWebhookRevoke',cas:true,maxItems:10});
operation('config.key.webhook.service.set','Enregistrer le jeton de service webhook','command',webhookServiceInput,
  configOutput,'manage',['connector_config','connector_secret'],['connector_config','connector_secret'],
  {exportName:'configWebhookServiceSet',cas:true,maxItems:10});
operation('config.key.webhook.service.revoke','Révoquer le jeton de service webhook','command',keyRevokeInput,
  configOutput,'manage',['connector_config','connector_secret'],['connector_config','connector_secret'],
  {exportName:'configWebhookServiceRevoke',cas:true,maxItems:10});
operation('connection.check','Vérifier la connexion Stripe','query',empty,checkOutput,'manage',
  ['connector_config','connector_secret'],[],{exportName:'connectionCheck',remote:true});
operation('checkout.payment.create','Créer un Checkout de paiement test','command',checkoutCreateInput,
  checkoutOutput,'manage',['connector_config','connector_secret','stripe_price'],['stripe_checkout'],
  {exportName:'checkoutPaymentCreate',remote:true,maxItems:12});
operation('checkout.subscription.create','Créer un Checkout abonnement test','command',checkoutCreateInput,
  checkoutOutput,'manage',['connector_config','connector_secret','stripe_price'],['stripe_checkout'],
  {exportName:'checkoutSubscriptionCreate',remote:true,maxItems:12});
operation('checkout.read','Relire une session Checkout test','query',checkoutReadInput,checkoutOutput,
  'manage',['connector_config','connector_secret','stripe_checkout'],[],
  {exportName:'checkoutRead',remote:true,maxItems:8});
operation('subscription.cancel.schedule','Programmer l’arrêt d’un abonnement test','command',cancelInput,
  cancelOutput,'manage',['connector_config','connector_secret','stripe_subscription'],['stripe_subscription'],
  {exportName:'subscriptionCancelSchedule',remote:true,cas:true,maxItems:12});
operation('event.receive','Enregistrer un événement Stripe signé','command',eventInput,eventOutput,
  'webhook.receive',['connector_config','stripe_event','stripe_checkout'],['stripe_event','stripe_checkout'],
  {exportName:'eventReceive',maxItems:12});
operations.at(-1).actors=['machine','signed-webhook'];
operation('event.list','Lire les événements Stripe rapprochés','query',listInput,eventListOutput,
  'read',['connector_config','stripe_event'],[],{exportName:'eventList',
    pagination:{mode:'cursor',cursorField:'cursor',limitField:'limit',maxItems:25},maxItems:27});
operation('sync.state','Lire l’état des parcours Stripe','query',empty,statesOutput,'read',
  ['connector_config','sync_state','stripe_catalog_sync_state'],[],{exportName:'syncState',maxItems:8});
operation('sync.start','Démarrer un parcours de lecture Stripe','command',startInput,startOutput,'manage',
  ['connector_config','sync_state','stripe_catalog_sync_state'],['sync_state','stripe_catalog_sync_state'],
  {exportName:'syncStart',maxItems:8});
// Each projection has its own revision; sync.page uses explicit per-row and run CAS in one batch.
operation('sync.page','Lire et projeter une page Stripe','command',pageInput,pageOutput,'manage',
  ['connector_config','connector_secret','sync_state','stripe_catalog_sync_state','stripe_customer',
    'stripe_subscription','stripe_invoice','stripe_product','stripe_price'],
  ['sync_state','stripe_catalog_sync_state','stripe_customer','stripe_subscription','stripe_invoice',
    'stripe_product','stripe_price'],
  {exportName:'syncPage',remote:true,maxItems:32});
for(const [name,output,model,exportName] of [
  ['customer.list',customerOutput,'stripe_customer','customerList'],
  ['subscription.list',subscriptionOutput,'stripe_subscription','subscriptionList'],
  ['invoice.list',invoiceOutput,'stripe_invoice','invoiceList']])
  operation(name,`Lire les ${model.slice(7)}s projetés`, 'query',listInput,output,'read',
    ['connector_config',model],[],
    {exportName,pagination:{mode:'cursor',cursorField:'cursor',limitField:'limit',maxItems:25},maxItems:27});
for(const [name,output,model,exportName] of [
  ['product.list',productOutput,'stripe_product','productList'],
  ['price.list',priceOutput,'stripe_price','priceList']])
  operation(name,`Lire les ${model.slice(7)}s projetés`,'query',listInput,output,'read',
    ['connector_config',model],[],
    {exportName,pagination:{mode:'cursor',cursorField:'cursor',limitField:'limit',maxItems:25},maxItems:27});
const api=[];
for(const op of operations){
  if(op.id==='event.receive')continue;
  const definition=schemas.find(item=>item.id===op.input.schemaId).schema;
  api.push({id:`admin.${op.id}`,method:op.kind==='command'?'POST':'GET',
    path:`/api/admin/stripe/${op.id.replaceAll('.','/')}`,operation:ref('operation',op.id),audience:'admin',
    auth:['session','oauth','api-token'],parameters:op.kind==='command'?[]:
      Object.entries(definition.properties).filter(([,value])=>['string','integer','boolean'].includes(value.type))
        .map(([name])=>({name:name.replace(/[A-Z]/gu,letter=>`_${letter.toLowerCase()}`),
          in:'query',inputField:name,required:definition.required.includes(name)})),
    input:op.input,output:op.output,rateLimit:{requests:30,windowSeconds:60}});
}
api.push({id:'webhook.event.receive',method:'POST',path:'/api/webhooks/stripe',
  operation:ref('operation','event.receive'),audience:'admin',auth:['webhook-signature'],parameters:[],
  input:eventInput,output:eventOutput,rateLimit:{requests:120,windowSeconds:60}});
const mcpTools=operations.filter(op=>op.id!=='event.receive').map(op=>({id:op.id,name:`stripe_${op.id.replaceAll('.','_')}`,
  operation:ref('operation',op.id),audiences:['admin'],auth:['oauth','api-token'],input:op.input,output:op.output,
  annotations:{readOnly:op.kind==='query',destructive:op.id==='config.key.revoke',
    idempotent:op.kind==='query',openWorld:op.effects.providers.length>0},
  ...(op.id==='sync.state'?{widget:ref('widget','sync-status')}:{ }),textFallback:true}));
const widgetResource={id:'sync-status-ui',uri:`ui://${id}/sync-status`,mimeType:'text/html;profile=mcp-app',
  audiences:['admin'],permissions:[ref('permission','read')],
  source:{kind:'asset',path:'ui/widgets/sync-status.html'},widget:ref('widget','sync-status'),
  ui:{csp:{connectDomains:[],resourceDomains:[],frameDomains:[],baseUriDomains:[]},
    permissions:{},prefersBorder:true}};
const widget={id:'sync-status',version:'1.0.0',compatibility:'^1.0.0',resource:'sync-status-ui',
  renderer:{path:'ui/widgets/sync-status.ts',export:'startSyncStatus'},input:statesOutput,
  state:empty,result:statesOutput,audiences:['admin'],permissions:[ref('permission','read')],
  requiredCapabilities:[],assets:[],actions:[{id:'refresh',label:'Relire l’état',input:empty,
    requiredCapabilities:[],fallback:'unavailable',mode:'direct',target:{kind:'operation',
      operation:ref('operation','sync.state')}}],
  instance:{identity:'host-generated',revision:'monotonic',correlation:'request-instance-conversation',
    objectVersion:'distinct',lateResponse:'reject-stale'},
  transport:{protocol:'mcp-apps',maxPayloadBytes:65536,timeoutMs:15000,
    uncertainResult:'reconcile-before-retry',fallbackDispatch:'before-first-dispatch-only'}};

const m=structuredClone(template),skillPath='plugin/skills/stripe.md';
const skillIntegrity=`sha256-${createHash('sha256').update(readFileSync(new URL(skillPath,root))).digest('hex')}`;
m.identity={id,title:'Connecteur Stripe',publisher:'creezio',origin:'https://github.com/creezio/Creezio-D1R2',
  version,source:{kind:'snapshot',revision:sourceRevision,
    integrity:`sha256-${createHash('sha256').update(sourceRevision).digest('hex')}`},
  license:{expression:'NOASSERTION',file:'LICENSE'}};
m.compatibility={core:'^0.0.0',sdk:'^1.6.0',requiredCapabilities:['runtime.worker','data.d1.shared'],optionalCapabilities:[]};
m.entrypoints={server:{path:'module/entry.server.ts',export:'stripe'},ui:{path:'ui/index.tsx',export:'StripeAdminView'},
  plugin:{manifest:'plugin/plugin.json',mcp:'plugin/mcp.json',
    contributions:{path:'plugin/contributions.ts',export:'contributions'}}};
m.dependencies=[{moduleId:'creezio.access',origin:m.identity.origin,versionRange:'^0.0.0',optional:false,
  contracts:[],whenAbsent:'block',whenIncompatible:'block',autoInstall:false}];
m.contracts={schemas,models,files:[],events:[],connectors:[structuredClone(stripeConnectorDescriptor)],settings:[
  {id:'api-key-ref',title:'Référence de clé Stripe',schema:schema('key-reference-setting',str(128)),
    visibility:'secret-reference',required:false,permissions:[ref('permission','manage')],provider:connectorId,redact:true}],
  search:[],permissions,operations,api,mcp:{tools:mcpTools,resources:[widgetResource],prompts:[],
    skills:[{id:'stripe',path:skillPath,audiences:['admin'],operations:[ref('operation','sync.state'),
      ref('operation','customer.list'),ref('operation','subscription.list'),ref('operation','invoice.list'),
      ref('operation','product.list'),ref('operation','price.list'),
      ref('operation','checkout.payment.create'),ref('operation','checkout.subscription.create'),
      ref('operation','checkout.read'),ref('operation','subscription.cancel.schedule'),
      ref('operation','event.list')],
      resources:['sync-status-ui'],integrity:skillIntegrity}]},
  ui:{views:[{id:'admin',title:'Facturation',surfaces:['workspace'],route:'/admin/billing',
    component:{path:'ui/index.tsx',export:'StripeAdminView'},permissions:[ref('permission','manage')],
    operations:operations.filter(op=>op.id!=='event.receive').map(op=>ref('operation',op.id)),input:viewInput,
    panel:{identityFields:[],navigation:'sdk',retention:'preserve',inactiveEffects:'suspend',stateSchema:panelState}}],
    navigation:[{id:'stripe-admin',title:'Facturation',view:ref('view','admin'),
      permissions:[ref('permission','manage')],surfaces:['workspace'],order:80}],slots:[],
    front:{mode:'absent',justification:{reason:'Checkout URLs are issued by an authorized administrative operation; this module does not render a customer checkout page.',
      policyRule:'stripe.admin-checkout-api'}},themes:[],styles:[]},
  widgets:[widget],publicContracts:[]};
m.documentation.versionBinding={moduleVersion:version,sourceRevision};
for(const suite of ['backend','ui','api-mcp','widgets','package','docs'])m.validation.suites[suite].tests=[`tests/${suite}/contract.test.mjs`];
m.validation.suites.widgets.mode='required';delete m.validation.suites.widgets.justification;
m.packaging.runtime.files=['module/manifest.json','module/models.json','module/entry.server.ts','module/storage.ts',
  'module/operations.ts','module/service.ts','module/projection.ts','module/webhook.ts',
  'ui/index.tsx','ui/panel-state.ts','ui/state.ts','ui/money.ts',
  'ui/widgets/sync-status.ts','ui/widgets/sync-status.html',
  'README.md','prd.md','CHANGELOG.md','LICENSE','plugin/plugin.json','plugin/mcp.json',
  'plugin/contributions.ts',skillPath];
m.packaging.validation.files=['AGENTS.md','FILES.md','interview.md','TODO.md','gate.mjs',
  'module/generate-manifest.mjs','ci/run-suite.mjs','tests/helpers.mjs',
  ...['backend','ui','api-mcp','widgets','package','docs'].flatMap(name=>
    [`ci/${name}.mjs`,`tests/${name}/contract.test.mjs`])];
m.packaging.validationBinding={moduleId:id,moduleVersion:version,sourceRevision};
m.lifecycle.absent={files:{reason:'Stripe payment data does not store file content.',policyRule:'stripe.no-files'}};
m.lifecycle.configuration='explicit-state';
writeFileSync(new URL('module/models.json',root),JSON.stringify(models,null,2)+'\n');
writeFileSync(new URL('module/manifest.json',root),JSON.stringify(m,null,2)+'\n');
