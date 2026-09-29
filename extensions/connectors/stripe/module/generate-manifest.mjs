import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {stripeConnectorDescriptor} from './storage.ts';

const root=new URL('../',import.meta.url);
const template=JSON.parse(readFileSync(new URL('module/manifest.json',root),'utf8'));
const id='creezio.stripe',connectorId='stripe.api.v1',version='0.1.0',sourceRevision='t27-stripe-read-projection-v1';
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
  field('enabled','boolean'),revisionField,updatedField],['manage','read']);
model('connector_secret','Clé Stripe scellée',[
  field('id','string',{protected:true,constraints:{minLength:1,maxLength:128}}),
  field('binding_id','string',{protected:true,constraints:{minLength:1,maxLength:128}}),
  field('ciphertext','string',{protected:true,constraints:{minLength:1,maxLength:32768}}),
  field('key_id','string',{protected:true,constraints:{minLength:1,maxLength:128}}),
  field('version','integer',{protected:true,constraints:{minimum:1}}),
  field('state','string',{protected:true,constraints:{enum:['active','revoked']}})],['manage']);
const collections=['customers','subscriptions','invoices'];
model('sync_state','Parcours de lecture Stripe',[field('id','string',{constraints:{enum:collections}}),
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

const schemas=[],schema=(name,value)=>{schemas.push({id:name,schema:value});return {schemaId:name};};
const requestKey=str(128),revision=integer(0),stripeId=str(128),cursor=nullable(str(128));
const collection={type:'string',enum:collections},status={type:'string',enum:['partial','pages_exhausted']};
const configView=obj({origin:{const:'https://api.stripe.com'},enabled:{type:'boolean'},hasKey:{type:'boolean'},
  revision,state:{type:'string',enum:['missing','configured','unverified']}});
const runView=obj({collection,runId:nullable(str(128)),cursor,status,revision,updatedAt:nullable(str(64))});
const empty=schema('empty-input',obj({}));
const configOutput=schema('config-output',obj({config:configView}));
const configSetInput=schema('config-set-input',obj({requestKey,enabled:{type:'boolean'},revision}));
const keySetInput=schema('config-key-set-input',obj({requestKey,apiKey:str(4096,8),revision}));
const keyRevokeInput=schema('config-key-revoke-input',obj({requestKey,revision}));
const checkOutput=schema('connection-check-output',obj({reachable:{const:true}}));
const statesOutput=schema('sync-states-output',obj({states:array(runView,3)}));
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
  livemode:{type:'boolean'},updated_at:str(64)});
const invoice=obj({id:stripeId,customer_id:nullable(stripeId),status:nullable(str(64)),currency:str(3),
  amount_due_minor:{type:'integer',description:'Raw Stripe minor-unit amount; interpret with the currency and Stripe rules, never divide every currency by 100.'},
  period_start_at:nullable(str(64)),period_end_at:nullable(str(64)),livemode:{type:'boolean'},updated_at:str(64)});
const customerOutput=schema('customer-list-output',obj({items:array(customer,25),nextCursor:cursor}));
const subscriptionOutput=schema('subscription-list-output',obj({items:array(subscription,25),nextCursor:cursor}));
const invoiceOutput=schema('invoice-list-output',obj({items:array(invoice,25),nextCursor:cursor}));
const panelState=schema('stripe-panel-state',obj({sessionId:str(128),audience:{const:'admin'},contextId:str(128),
  tab:{type:'string',enum:['overview','customers','subscriptions','invoices','settings']},
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
  resources:['connector_config','sync_state','stripe_customer','stripe_subscription','stripe_invoice'].map(name=>ref('model',name)),
  actions:['read','execute'],enforcement:{request:true,commit:true},public:false}];
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
    audit:{required:true,redactFields:['apiKey']},public:false});
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
operation('connection.check','Vérifier la connexion Stripe','query',empty,checkOutput,'manage',
  ['connector_config','connector_secret'],[],{exportName:'connectionCheck',remote:true});
operation('sync.state','Lire l’état des parcours Stripe','query',empty,statesOutput,'read',
  ['connector_config','sync_state'],[],{exportName:'syncState',maxItems:5});
operation('sync.start','Démarrer un parcours de lecture Stripe','command',startInput,startOutput,'manage',
  ['connector_config','sync_state'],['sync_state'],{exportName:'syncStart',maxItems:6});
// Each projection has its own revision; sync.page uses explicit per-row and run CAS in one batch.
operation('sync.page','Lire et projeter une page Stripe','command',pageInput,pageOutput,'manage',
  ['connector_config','connector_secret','sync_state','stripe_customer','stripe_subscription','stripe_invoice'],
  ['sync_state','stripe_customer','stripe_subscription','stripe_invoice'],
  {exportName:'syncPage',remote:true,maxItems:32});
for(const [name,output,model,exportName] of [
  ['customer.list',customerOutput,'stripe_customer','customerList'],
  ['subscription.list',subscriptionOutput,'stripe_subscription','subscriptionList'],
  ['invoice.list',invoiceOutput,'stripe_invoice','invoiceList']])
  operation(name,`Lire les ${model.slice(7)}s projetés`, 'query',listInput,output,'read',
    ['connector_config',model],[],
    {exportName,pagination:{mode:'cursor',cursorField:'cursor',limitField:'limit',maxItems:25},maxItems:27});
const api=[];
for(const op of operations){
  const definition=schemas.find(item=>item.id===op.input.schemaId).schema;
  api.push({id:`admin.${op.id}`,method:op.kind==='command'?'POST':'GET',
    path:`/api/admin/stripe/${op.id.replaceAll('.','/')}`,operation:ref('operation',op.id),audience:'admin',
    auth:['session','oauth','api-token'],parameters:op.kind==='command'?[]:
      Object.entries(definition.properties).filter(([,value])=>['string','integer','boolean'].includes(value.type))
        .map(([name])=>({name,in:'query',inputField:name,required:definition.required.includes(name)})),
    input:op.input,output:op.output,rateLimit:{requests:30,windowSeconds:60}});
}
const mcpTools=operations.map(op=>({id:op.id,name:`stripe_${op.id.replaceAll('.','_')}`,
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
m.compatibility={core:'^0.0.0',sdk:'^1.4.0',requiredCapabilities:['runtime.worker','data.d1.shared'],optionalCapabilities:[]};
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
      ref('operation','customer.list'),ref('operation','subscription.list'),ref('operation','invoice.list')],
      resources:['sync-status-ui'],integrity:skillIntegrity}]},
  ui:{views:[{id:'admin',title:'Facturation',surfaces:['workspace'],route:'/admin/billing',
    component:{path:'ui/index.tsx',export:'StripeAdminView'},permissions:[ref('permission','manage')],
    operations:operations.map(op=>ref('operation',op.id)),input:viewInput,
    panel:{identityFields:[],navigation:'sdk',retention:'preserve',inactiveEffects:'suspend',stateSchema:panelState}}],
    navigation:[{id:'stripe-admin',title:'Facturation',view:ref('view','admin'),
      permissions:[ref('permission','manage')],surfaces:['workspace'],order:80}],slots:[],
    front:{mode:'absent',justification:{reason:'The original billing page is administrative; no customer payment front is in this read-only slice.',
      policyRule:'stripe.admin-only-first-slice'}},themes:[],styles:[]},
  widgets:[widget],publicContracts:[]};
m.documentation.versionBinding={moduleVersion:version,sourceRevision};
for(const suite of ['backend','ui','api-mcp','widgets','package','docs'])m.validation.suites[suite].tests=[`tests/${suite}/contract.test.mjs`];
m.validation.suites.widgets.mode='required';delete m.validation.suites.widgets.justification;
m.packaging.runtime.files=['module/manifest.json','module/models.json','module/entry.server.ts','module/storage.ts',
  'module/operations.ts','module/service.ts','module/projection.ts','ui/index.tsx','ui/panel-state.ts','ui/state.ts','ui/money.ts',
  'ui/widgets/sync-status.ts','ui/widgets/sync-status.html',
  'README.md','prd.md','CHANGELOG.md','LICENSE','plugin/plugin.json','plugin/mcp.json',
  'plugin/contributions.ts',skillPath];
m.packaging.validation.files=['AGENTS.md','FILES.md','interview.md','TODO.md','gate.mjs',
  'module/generate-manifest.mjs','ci/run-suite.mjs','tests/helpers.mjs',
  ...['backend','ui','api-mcp','widgets','package','docs'].flatMap(name=>
    [`ci/${name}.mjs`,`tests/${name}/contract.test.mjs`])];
m.packaging.validationBinding={moduleId:id,moduleVersion:version,sourceRevision};
m.lifecycle.absent={files:{reason:'This read-only Stripe projection stores no file content.',policyRule:'stripe.no-files'}};
m.lifecycle.configuration='explicit-state';
writeFileSync(new URL('module/models.json',root),JSON.stringify(models,null,2)+'\n');
writeFileSync(new URL('module/manifest.json',root),JSON.stringify(m,null,2)+'\n');
