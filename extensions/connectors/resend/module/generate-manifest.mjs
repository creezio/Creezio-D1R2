import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resendConnectorDescriptor} from './storage.ts';

const root=new URL('../',import.meta.url);
const template=JSON.parse(readFileSync(new URL('module/manifest.json',root),'utf8'));
const id='creezio.resend',connectorId='resend.api.v1',version='0.2.0',revision='t29-resend-inbound-v2';
const ref=(kind,name)=>({moduleId:id,kind,id:name});
const str=(max=128,min=1)=>({type:'string',minLength:min,maxLength:max});
const num=(min=0,max=Number.MAX_SAFE_INTEGER)=>({type:'integer',minimum:min,maximum:max});
const nullable=value=>({anyOf:[value,{type:'null'}]});
const obj=(properties,required=Object.keys(properties))=>({type:'object',properties,required,additionalProperties:false});
const field=(id,type,options={})=>({id,type,nullable:options.nullable??false,
  protected:options.protected??false,computed:false,...(options.constraints?{constraints:options.constraints}:{})});
const model=(name,title,fields,access=['manage'])=>({id:name,title,scope:'context',contextField:'context_id',
  fields:[field('context_id','string',{protected:true,constraints:{minLength:1,maxLength:128}}),...fields],
  primaryKey:['context_id','id'],indexes:[],relations:[],permissions:access.map(name=>ref('permission',name)),
  deletion:{mode:'soft',requiresApproval:false},public:false});
const models=[model('connector_config','Configuration Resend',[
  field('id','string',{constraints:{minLength:1,maxLength:128}}),
  field('origin','string',{constraints:{minLength:8,maxLength:512}}),
  field('from_address','string',{constraints:{minLength:3,maxLength:320}}),
  field('key_ref','string',{nullable:true,constraints:{minLength:1,maxLength:128}}),
  field('secret_version','integer',{nullable:true,constraints:{minimum:1}}),
  field('connection_id','string',{nullable:true,constraints:{minLength:1,maxLength:128}}),
  field('webhook_key_ref','string',{nullable:true,constraints:{minLength:1,maxLength:128}}),
  field('webhook_secret_version','integer',{nullable:true,constraints:{minimum:1}}),
  field('webhook_previous_key_ref','string',{nullable:true,constraints:{minLength:1,maxLength:128}}),
  field('webhook_previous_secret_version','integer',{nullable:true,constraints:{minimum:1}}),
  field('webhook_service_token_ref','string',{nullable:true,constraints:{minLength:1,maxLength:128}}),
  field('webhook_service_token_version','integer',{nullable:true,constraints:{minimum:1}}),
  field('enabled','boolean'),field('revision','integer',{constraints:{minimum:1}}),
  field('updated_at','date-time')],['manage','use']),
  model('connector_secret','Secret Resend scellé',[
    field('id','string',{protected:true,constraints:{minLength:1,maxLength:128}}),
    field('binding_id','string',{protected:true,constraints:{minLength:1,maxLength:128}}),
    field('ciphertext','string',{protected:true,constraints:{minLength:1,maxLength:32768}}),
    field('key_id','string',{protected:true,constraints:{minLength:1,maxLength:128}}),
    field('version','integer',{protected:true,constraints:{minimum:1}}),
  field('state','string',{protected:true,constraints:{enum:['active','revoked']}})],['manage','use']),
  model('webhook_event','Événement Resend signé',[
    field('id','string',{constraints:{minLength:1,maxLength:128}}),
    field('connection_id','string',{constraints:{minLength:1,maxLength:128}}),
    field('event_type','string',{constraints:{enum:['email.sent','email.delivered','email.bounced','email.failed','email.received']}}),
    field('email_id','string',{constraints:{minLength:1,maxLength:256}}),
    field('body_digest','string',{constraints:{minLength:64,maxLength:64}}),
    field('occurred_at','date-time'),field('received_at','date-time')],['manage'])];
models.find(item=>item.id==='webhook_event').indexes=[{id:'by-email',
  fields:['context_id','connection_id','email_id','occurred_at','id'],unique:false}];
models.find(item=>item.id==='webhook_event').permissions.push(ref('permission','use'));
models.find(item=>item.id==='webhook_event').permissions.push(ref('permission','webhook.receive'));
models.find(item=>item.id==='connector_config').permissions.push(ref('permission','webhook.receive'));
const schemas=[],schema=(name,value)=>{schemas.push({id:name,schema:value});return {schemaId:name};};
const requestKey=str(128),rev=num(0);
const configView=obj({origin:nullable(str(512)),from:nullable(str(320)),enabled:{type:'boolean'},
  hasKey:{type:'boolean'},hasWebhookSecret:{type:'boolean'},hasWebhookService:{type:'boolean'},
  state:{type:'string',enum:['missing','configured','disabled']},revision:rev});
const configOutput=schema('config-output',obj({config:configView}));
const empty=schema('empty-input',obj({}));
const configInput=schema('config-set-input',obj({requestKey,from:str(320,3),enabled:{type:'boolean'},revision:rev}));
const keyInput=schema('config-key-set-input',obj({requestKey,apiKey:str(4096,8),revision:rev}));
const keyRevokeInput=schema('config-key-revoke-input',obj({requestKey,revision:rev}));
const webhookInput=schema('config-webhook-secret-input',obj({requestKey,webhookSecret:str(512,16),revision:rev}));
const webhookServiceInput=schema('config-webhook-service-input',obj({requestKey,serviceToken:str(256,32),revision:rev}));
const eventInput=schema('webhook-event-input',obj({requestKey,eventId:str(),bodyDigest:str(64,64),
  eventType:{type:'string',enum:['email.sent','email.delivered','email.bounced','email.failed','email.received']},
  emailId:str(256),occurredAt:str(40)}));
const eventOutput=schema('webhook-event-output',obj({eventId:str(),recorded:{const:true}}));
const statusInput=schema('delivery-event-status-input',obj({emailId:str(256)}));
const statusOutput=schema('delivery-event-status-output',obj({kind:{enum:['none','delivered','bounced','failed']},
  eventId:nullable(str()),occurredAt:nullable(str(40))}));
const receivedInput=schema('received-email-read-input',obj({emailId:str(128)}));
const receivedOutput=schema('received-email-read-output',obj({emailId:str(128),
  to:{type:'array',items:str(320),minItems:1,maxItems:20},from:str(320),
  subject:str(240,0),text:str(16000,0),html:str(32000,0),receivedAt:str(40),
  connectionId:str(128),configRevision:rev,
  attachments:{type:'array',items:obj({id:str(128),filename:str(255),
    contentType:str(128),byteSize:num(0,10*1024*1024)}),maxItems:50},
  attachmentCount:num(0,50)}));
const domain=obj({id:str(),name:str(320),status:str(64)});
const domainOutput=schema('domain-list-output',obj({domains:{type:'array',items:domain,maxItems:100}}));
const readinessOutput=schema('delivery-readiness-output',obj({state:{type:'string',enum:['ready','missing','unavailable']},
  from:nullable(str(320)),configRevision:rev}));
const panelState=schema('resend-panel-state',obj({sessionId:str(),audience:{type:'string',enum:['admin','app']},
  contextId:str(),pending:obj({sessionId:str(),audience:{type:'string',enum:['admin','app']},
    contextId:str(),bindingId:str(257),requestKey:str(512)},['sessionId','audience','contextId','bindingId','requestKey'])},[]));
const viewInput=schema('resend-view-input',obj({}));
const permissions=[{id:'manage',title:'Configurer Resend',audiences:['admin'],
  actors:['user','delegated-user','machine'],scopes:['resend.manage'],context:'required',default:'deny',
  resources:models.map(model=>ref('model',model.id)),actions:['read','create','update','execute'],
  enforcement:{request:true,commit:true},public:false},
  {id:'use',title:'Utiliser le transport Resend',audiences:['admin','app'],
    actors:['user','delegated-user','machine'],scopes:['resend.use'],context:'required',default:'deny',
    resources:[ref('model','connector_config'),ref('model','connector_secret'),ref('model','webhook_event')],actions:['read','execute'],
    enforcement:{request:true,commit:true},public:false},
  {id:'webhook.receive',title:'Recevoir les événements Resend signés',audiences:['admin'],
    actors:['machine'],scopes:['resend.webhook.receive'],context:'required',default:'deny',
    resources:[ref('model','connector_config'),ref('model','webhook_event')],
    actions:['read','create','execute'],enforcement:{request:true,commit:true},public:false}];
const errors=['invalid_input','unauthorized','forbidden','not_found','conflict','rate_limited','unsupported','unavailable','unknown']
  .map(code=>({code,retryable:['rate_limited','unavailable','unknown'].includes(code),
    outcome:code==='unknown'?'unknown':'rejected'}));
const operations=[];
function operation(name,title,kind,input,output,reads,writes,options={}){
  const command=kind==='command';
  operations.push({id:name,title,kind,input,output,permissions:[ref('permission',options.permission??'manage')],
    audiences:options.permission==='use'?['admin','app']:['admin'],actors:['user','delegated-user','machine'],context:'required',
    handler:{path:'module/operations.ts',export:options.exportName},
    effects:{reads:reads.map(name=>ref('model',name)),writes:writes.map(name=>ref('model',name)),
      emits:[],calls:[],providers:options.remote?[connectorId]:[]},errors,
    pagination:{mode:'none'},
    idempotency:command?{mode:'required',keyField:'requestKey',scope:'actor-context-operation',retentionSeconds:86400}:{mode:'none'},
    approval:{mode:'none'},concurrency:options.cas?{mode:'object-version',versionField:'revision'}:{mode:'none'},
    execution:{maxDurationMs:10000,maxItems:options.maxItems??4,resumable:false},
    audit:{required:true,redactFields:['apiKey','webhookSecret','serviceToken']},public:options.public===true});
}
operation('config.read','Lire la configuration Resend','query',empty,configOutput,['connector_config'],[],{exportName:'configRead'});
operation('config.set','Configurer l’expéditeur Resend','command',configInput,configOutput,
  ['connector_config'],['connector_config'],{exportName:'configSet',cas:true});
operation('config.key.set','Enregistrer la clé API Resend','command',keyInput,configOutput,
  ['connector_config','connector_secret'],['connector_config','connector_secret'],{exportName:'configKeySet',cas:true,maxItems:8});
operation('config.key.revoke','Révoquer la clé API Resend','command',keyRevokeInput,configOutput,
  ['connector_config','connector_secret'],['connector_config','connector_secret'],{exportName:'configKeyRevoke',cas:true,maxItems:8});
operation('config.key.webhook.set','Sceller le secret webhook Resend','command',webhookInput,configOutput,
  ['connector_config','connector_secret'],['connector_config','connector_secret'],{exportName:'configWebhookSet',cas:true,maxItems:6});
operation('config.key.webhook.revoke','Révoquer le secret webhook Resend','command',keyRevokeInput,configOutput,
  ['connector_config','connector_secret'],['connector_config','connector_secret'],{exportName:'configWebhookRevoke',cas:true,maxItems:6});
operation('config.key.webhook.service.set','Sceller le jeton webhook Resend','command',webhookServiceInput,configOutput,
  ['connector_config','connector_secret'],['connector_config','connector_secret'],{exportName:'configWebhookServiceSet',cas:true,maxItems:6});
operation('config.key.webhook.service.revoke','Révoquer le jeton webhook Resend','command',keyRevokeInput,configOutput,
  ['connector_config','connector_secret'],['connector_config','connector_secret'],{exportName:'configWebhookServiceRevoke',cas:true,maxItems:6});
operation('event.receive','Enregistrer un événement Resend signé','command',eventInput,eventOutput,
  ['connector_config','webhook_event'],['webhook_event'],{exportName:'eventReceive',permission:'webhook.receive'});
operations.at(-1).actors=['machine','signed-webhook'];
operation('event.status','Lire un accusé signé pour un envoi connu','query',statusInput,statusOutput,
  ['connector_config','webhook_event'],[],{exportName:'eventStatus',permission:'use',public:true,maxItems:52});
operation('received.read','Lire un courriel reçu confirmé par webhook','query',receivedInput,receivedOutput,
  ['connector_config','webhook_event'],[],{exportName:'receivedRead',permission:'use',public:true,remote:true,maxItems:52});
operation('domain.list','Lire les domaines Resend','query',empty,domainOutput,
  ['connector_config'],[],{exportName:'domainList',remote:true,maxItems:100});
operation('delivery.readiness','Vérifier l’éligibilité locale du transport','query',empty,readinessOutput,
  ['connector_config'],[],{exportName:'deliveryReadiness',permission:'use',public:true});
const api=[];
for(const op of operations.filter(op=>!['event.receive','event.status','received.read'].includes(op.id))){
  for(const audience of op.audiences)api.push({id:`${audience}.${op.id}`,method:op.kind==='command'?'POST':'GET',
    path:`/api/${audience}/resend/${op.id.replaceAll('.','/')}`,operation:ref('operation',op.id),audience,
    auth:['session','oauth','api-token'],parameters:[],input:op.input,output:op.output,
    rateLimit:{requests:30,windowSeconds:60}});
}
api.push({id:'webhook.event.receive',method:'POST',path:'/api/webhooks/resend',
  operation:ref('operation','event.receive'),audience:'admin',auth:['webhook-signature'],parameters:[],
  input:eventInput,output:eventOutput,rateLimit:{requests:120,windowSeconds:60}});
const mcpTools=operations.filter(op=>!['event.receive','event.status','received.read'].includes(op.id)).map(op=>({id:op.id,name:`resend_${op.id.replaceAll('.','_')}`,
  operation:ref('operation',op.id),audiences:op.audiences,auth:['oauth','api-token'],input:op.input,output:op.output,
  annotations:{readOnly:op.kind==='query',destructive:op.id==='config.key.revoke',
    idempotent:op.kind==='query',openWorld:op.effects.providers.length>0},textFallback:true}));
const m=structuredClone(template);
m.identity={id,title:'Connecteur Resend',publisher:'creezio',origin:'https://github.com/creezio/Creezio-D1R2',
  version,source:{kind:'snapshot',revision,integrity:`sha256-${createHash('sha256').update(revision).digest('hex')}`},
  license:{expression:'NOASSERTION',file:'LICENSE'}};
m.compatibility={core:'^0.0.0',sdk:'^1.9.0',requiredCapabilities:['runtime.worker','data.d1.shared'],optionalCapabilities:[]};
m.entrypoints={server:{path:'module/entry.server.ts',export:'resend'},ui:{path:'ui/index.tsx',export:'ResendAdminView'},
  plugin:{manifest:'plugin/plugin.json',mcp:'plugin/mcp.json',
    contributions:{path:'plugin/contributions.ts',export:'contributions'}}};
m.dependencies=[{moduleId:'creezio.access',origin:m.identity.origin,versionRange:'^0.0.0',optional:false,
  contracts:[],whenAbsent:'block',whenIncompatible:'block',autoInstall:false}];
m.contracts={schemas,models,files:[],events:[],connectors:[structuredClone(resendConnectorDescriptor)],settings:[
  {id:'api-key-ref',title:'Référence de clé API Resend',schema:schema('key-reference-setting',str()),
    visibility:'secret-reference',required:false,permissions:[ref('permission','manage')],provider:connectorId,redact:true},
  {id:'from-address',title:'Adresse expéditeur Resend',schema:schema('from-setting',str(320,3)),
    visibility:'server',required:true,permissions:[ref('permission','manage')],provider:connectorId,redact:true}],
  search:[],permissions,operations,api,mcp:{tools:mcpTools,resources:[],prompts:[],skills:[]},
  ui:{views:[{id:'admin',title:'Resend',surfaces:['workspace'],route:'/admin/resend',
    component:{path:'ui/index.tsx',export:'ResendAdminView'},permissions:[ref('permission','manage')],
    operations:operations.filter(op=>!['delivery.readiness','event.receive','event.status','received.read'].includes(op.id)).map(op=>ref('operation',op.id)),input:viewInput,
    panel:{identityFields:[],navigation:'sdk',retention:'preserve',inactiveEffects:'suspend',stateSchema:panelState}}],
    navigation:[{id:'resend-admin',title:'Resend',view:ref('view','admin'),permissions:[ref('permission','manage')],
      surfaces:['workspace'],order:79}],slots:[],front:{mode:'absent',justification:{reason:'Resend settings belong to workspace.',
      policyRule:'resend.workspace-only'}},themes:[],styles:[]},widgets:[],publicContracts:[
    {id:'delivery-readiness',version:'1.0.0',models:[],operations:[ref('operation','delivery.readiness')],events:[],
      schemas:[{schemaId:'empty-input'},{schemaId:'delivery-readiness-output'}]},
    {id:'delivery-events',version:'1.0.0',models:[],operations:[ref('operation','event.status')],events:[],
      schemas:[{schemaId:'delivery-event-status-input'},{schemaId:'delivery-event-status-output'}]},
    {id:'received-email',version:'1.0.0',models:[],operations:[ref('operation','received.read')],events:[],
      schemas:[{schemaId:'received-email-read-input'},{schemaId:'received-email-read-output'}]}]};
m.documentation.versionBinding={moduleVersion:version,sourceRevision:revision};
for(const suite of ['backend','ui','api-mcp','widgets','package','docs'])m.validation.suites[suite].tests=[`tests/${suite}/contract.test.mjs`];
m.validation.suites.widgets.mode='not-applicable';m.validation.suites.widgets.justification={
  reason:'No provider widget is shown until Messaging owns a durable delivery projection.',
  policyRule:'resend.no-premature-send-widget'};
m.packaging.runtime.files=['module/manifest.json','module/models.json','module/entry.server.ts','module/storage.ts','module/webhook.ts',
  'module/operations.ts','module/service.ts','ui/index.tsx','ui/panel-state.ts','README.md','prd.md','CHANGELOG.md',
  'LICENSE','plugin/plugin.json','plugin/mcp.json','plugin/contributions.ts'];
m.packaging.validation.files=['AGENTS.md','FILES.md','interview.md','TODO.md','gate.mjs',
  'module/generate-manifest.mjs','ci/run-suite.mjs','tests/helpers.mjs',
  ...['backend','ui','api-mcp','widgets','package','docs'].flatMap(name=>
    [`ci/${name}.mjs`,`tests/${name}/contract.test.mjs`])];
m.packaging.validationBinding={moduleId:id,moduleVersion:version,sourceRevision:revision};
m.lifecycle.absent={files:{reason:'Messaging owns attachments in private R2.',policyRule:'resend.no-files'},
  widgets:{reason:'No sent status exists before the durable Messaging projection.',policyRule:'resend.no-premature-send-widget'}};
m.lifecycle.configuration='explicit-state';
writeFileSync(new URL('module/models.json',root),JSON.stringify(models,null,2)+'\n');
writeFileSync(new URL('module/manifest.json',root),JSON.stringify(m,null,2)+'\n');
