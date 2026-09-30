import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {hermesConnectorDescriptor} from './storage.ts';

const root=new URL('../',import.meta.url),m=JSON.parse(readFileSync(new URL('module/manifest.json',root),'utf8'));
const id='creezio.hermes',connectorId='hermes.api.v1',version='0.1.1',revision='t29-hermes-widgets-v1';
const ref=(kind,name)=>({moduleId:id,kind,id:name});
const str=(max=128,min=1)=>({type:'string',minLength:min,maxLength:max});
const num=(min=0)=>({type:'integer',minimum:min,maximum:Number.MAX_SAFE_INTEGER});
const nullable=value=>({anyOf:[value,{type:'null'}]});
const obj=(properties,required=Object.keys(properties))=>({type:'object',properties,required,additionalProperties:false});
const field=(id,type,options={})=>({id,type,nullable:options.nullable??false,protected:options.protected??false,
  computed:false,...(options.constraints?{constraints:options.constraints}:{})});
const model=(name,title,fields,permission)=>({id:name,title,scope:'context',contextField:'context_id',
  fields:[field('context_id','string',{protected:true,constraints:{minLength:1,maxLength:128}}),...fields],
  primaryKey:['context_id','id'],indexes:[],relations:[],permissions:(Array.isArray(permission)?permission:[permission])
    .map(name=>ref('permission',name)),
  deletion:{mode:'soft',requiresApproval:false},public:false});
const models=[
  model('connector_config','Configuration Hermes',[
    field('id','string',{constraints:{minLength:1,maxLength:128}}),field('origin','string',{constraints:{minLength:8,maxLength:512}}),
    field('key_ref','string',{nullable:true,constraints:{minLength:1,maxLength:128}}),
    field('secret_version','integer',{nullable:true,constraints:{minimum:1}}),field('enabled','boolean'),
    field('revision','integer',{constraints:{minimum:1}}),field('generation','integer',{constraints:{minimum:1}}),
    field('updated_at','date-time')],['manage','connect']),
  model('connector_secret','Secret Hermes scellé',[
    field('id','string',{protected:true,constraints:{minLength:1,maxLength:128}}),
    field('binding_id','string',{protected:true,constraints:{minLength:1,maxLength:128}}),
    field('ciphertext','string',{protected:true,constraints:{minLength:1,maxLength:32768}}),
    field('key_id','string',{protected:true,constraints:{minLength:1,maxLength:128}}),
    field('version','integer',{protected:true,constraints:{minimum:1}}),
    field('state','string',{protected:true,constraints:{enum:['active','revoked']}})],['manage','connect']),
  model('connection_stamp','Génération de connexion Hermes',[
    field('id','string',{constraints:{minLength:1,maxLength:128}}),
    field('generation','integer',{constraints:{minimum:1}})],'use'),
  model('capability_snapshot','Capacités Hermes observées',[
    field('id','string',{constraints:{minLength:1,maxLength:128}}),
    field('connection_generation','integer',{constraints:{minimum:1}}),
    field('model','string',{constraints:{minLength:1,maxLength:128}}),
    ...['run_submission','run_status','run_events_sse','run_stop'].map(name=>field(name,'boolean')),
    field('observed_at','date-time'),field('revision','integer',{constraints:{minimum:1}})],'use'),
  model('run','Intention et projection de run Hermes',[
    field('id','string',{constraints:{minLength:1,maxLength:128}}),
    field('principal_id','string',{constraints:{minLength:1,maxLength:128}}),
    field('audience','string',{constraints:{enum:['admin','app']}}),
    field('connection_generation','integer',{constraints:{minimum:1}}),
    field('remote_id','string',{nullable:true,constraints:{minLength:1,maxLength:128}}),
    field('status','string',{constraints:{minLength:1,maxLength:32}}),
    field('input','string',{constraints:{minLength:1,maxLength:8192}}),
    field('result_text','string',{nullable:true,constraints:{minLength:0,maxLength:64000}}),
    field('model','string',{nullable:true,constraints:{minLength:1,maxLength:128}}),
    field('session_id','string',{nullable:true,constraints:{minLength:1,maxLength:128}}),
    field('revision','integer',{constraints:{minimum:1}}),
    field('created_at','date-time'),field('updated_at','date-time')],'use')
];
const schemas=[],schema=(name,value)=>{schemas.push({id:name,schema:value});return {schemaId:name};};
const configView=obj({origin:nullable(str(512)),enabled:{type:'boolean'},hasKey:{type:'boolean'},
  state:{type:'string',enum:['missing','configured','unavailable','unverified']},revision:num(),generation:num()});
const configOutput=schema('config-output',obj({config:configView}));
const empty=schema('empty-input',obj({}));
const configInput=schema('config-set-input',obj({requestKey:str(128),origin:str(512),enabled:{type:'boolean'},revision:num()}));
const keyInput=schema('config-key-set-input',obj({requestKey:str(128),apiKey:str(4096,8),revision:num()}));
const revokeInput=schema('config-key-revoke-input',obj({requestKey:str(128),revision:num()}));
const capabilityView=obj({model:str(128),features:obj({run_submission:{type:'boolean'},run_status:{type:'boolean'},
  run_events_sse:{type:'boolean'},run_stop:{type:'boolean'}}),observedAt:str(64)});
const capabilityOutput=schema('capabilities-output',obj({capabilities:capabilityView}));
const captureInput=schema('capabilities-capture-input',obj({requestKey:str(128)}));
const captureOutput=schema('capabilities-capture-output',obj({capabilities:capabilityView,revision:num(1)}));
const modelsOutput=schema('models-output',obj({models:{type:'array',items:obj({id:str(128)}),maxItems:100}}));
const runInput=schema('run-read-input',obj({id:str(128)}));
const prepareInput=schema('run-prepare-input',obj({requestKey:str(128),input:str(8192)}));
const actionInput=schema('run-action-input',obj({requestKey:str(160),id:str(128),revision:num(1)}));
const prepareOutput=schema('run-prepare-output',obj({id:str(128),status:{const:'prepared'},revision:num(1)}));
const submitOutput=schema('run-submit-output',obj({id:str(128),remoteId:str(128),
  status:{type:'string',enum:['started','queued','running']},revision:num(1)}));
const stopOutput=schema('run-stop-output',obj({id:str(128),status:{const:'stopping'},revision:num(1)}));
const remoteRun=obj({runId:str(128),status:str(32),sessionId:nullable(str(128)),output:nullable(str(64000)),model:nullable(str(128))});
const runOutput=schema('run-output',obj({run:obj({id:str(128),remote:nullable(remoteRun),status:str(32),revision:num(1)},
  ['id','remote','revision'])}));
const viewInput=schema('hermes-view-input',obj({}));
const panelScope={sessionId:str(128),audience:{type:'string',enum:['admin','app']},contextId:str(128)};
const pendingCommand=nullable(obj({...panelScope,bindingId:str(257),requestKey:str(512),
  intent:str(64),targetId:str(128)},['sessionId','audience','contextId','bindingId','requestKey']));
const panelState=schema('hermes-panel-state',obj({...panelScope,
  tab:{type:'string',enum:['settings','runs']},selectedRunId:nullable(str(128)),pending:pendingCommand},
  ['sessionId','audience','contextId','tab','selectedRunId']));
const permissions=[{id:'manage',title:'Configurer Hermes externe',audiences:['admin'],actors:['user','delegated-user','machine'],
  scopes:['hermes.manage'],context:'required',default:'deny',resources:models.map(x=>ref('model',x.id)),
  actions:['read','create','update','execute'],enforcement:{request:true,commit:true},public:false},
  {id:'connect',title:'Employer la connexion Hermes scellée',audiences:['admin','app'],actors:['user','delegated-user','machine'],
    scopes:['hermes.connect'],context:'required',default:'deny',resources:[ref('model','connector_config'),
      ref('model','connector_secret')],actions:['read','execute'],enforcement:{request:true,commit:true},public:false},
  {id:'use',title:'Utiliser Hermes externe',audiences:['admin','app'],actors:['user','delegated-user','machine'],
    scopes:['hermes.use'],context:'required',default:'deny',resources:[ref('model','run'),ref('model','connection_stamp'),
      ref('model','capability_snapshot')],
    actions:['read','create','update','execute'],enforcement:{request:true,commit:true},public:false}];
const errors=['invalid_input','unauthorized','forbidden','not_found','conflict','rate_limited','unsupported','unavailable','unknown']
  .map(code=>({code,retryable:['rate_limited','unavailable','unknown'].includes(code),outcome:code==='unknown'?'unknown':'rejected'}));
const operations=[];
function operation(name,title,kind,input,output,permission,reads,writes,exportName,remote=false){
  const command=kind==='command';
  operations.push({id:name,title,kind,input,output,permissions:[ref('permission',permission),
    ...(permission==='use'&&remote?[ref('permission','connect')]:[])],
    audiences:permission==='manage'?['admin']:['admin','app'],actors:['user','delegated-user','machine'],
    context:'required',handler:{path:'module/operations.ts',export:exportName},
    effects:{reads:reads.map(x=>ref('model',x)),writes:writes.map(x=>ref('model',x)),emits:[],calls:[],providers:remote?[connectorId]:[]},
    errors,pagination:{mode:'none'},idempotency:command?{mode:'required',keyField:'requestKey',
      scope:'actor-context-operation',retentionSeconds:name==='run.submit'?365*86400:86400}:{mode:'none'},approval:{mode:'none'},
    concurrency:['config.key.set','config.key.revoke','run.refresh','run.submit','run.stop'].includes(name)
      ?{mode:'object-version',versionField:'revision'}:{mode:'none'},
    execution:{maxDurationMs:10000,maxItems:['run.refresh','run.submit','run.stop'].includes(name)?7:
      name==='capabilities.capture'?5:4,
      resumable:false},audit:{required:true,redactFields:['apiKey']},public:false});
}
operation('config.read','Lire la configuration Hermes','query',empty,configOutput,'manage',['connector_config'],[],'configRead');
operation('config.set','Configurer Hermes','command',configInput,configOutput,'manage',['connector_config','connection_stamp'],['connector_config','connection_stamp'],'configSet');
operation('config.key.set','Sceller la clé Hermes','command',keyInput,configOutput,'manage',['connector_config','connector_secret','connection_stamp'],['connector_config','connector_secret','connection_stamp'],'configKeySet');
operation('config.key.revoke','Révoquer la clé Hermes','command',revokeInput,configOutput,'manage',['connector_config','connector_secret','connection_stamp'],['connector_config','connector_secret','connection_stamp'],'configKeyRevoke');
operation('capabilities.read','Lire les capacités Hermes','query',empty,capabilityOutput,'manage',['connector_config'],[],'capabilitiesRead',true);
operation('capabilities.capture','Actualiser les capacités Hermes','command',captureInput,captureOutput,'manage',
  ['connector_config','capability_snapshot'],['capability_snapshot'],'capabilitiesCapture',true);
operation('models.list','Lister les modèles Hermes','query',empty,modelsOutput,'manage',['connector_config'],[],'modelsList',true);
operation('run.read','Relire un run autorisé','query',runInput,runOutput,'use',
  ['run','connection_stamp','capability_snapshot'],[],'runRead',true);
operation('run.refresh','Enregistrer l’état d’un run Hermes','command',actionInput,runOutput,'use',
  ['run','connection_stamp','capability_snapshot'],['run'],'runRefresh',true);
operation('run.prepare','Préparer une intention Hermes','command',prepareInput,prepareOutput,'use',
  ['connection_stamp','capability_snapshot'],['run'],'runPrepare');
operation('run.submit','Soumettre une intention Hermes','command',actionInput,submitOutput,'use',
  ['run','connection_stamp','capability_snapshot'],['run'],'runSubmit',true);
operation('run.stop','Demander l’arrêt Hermes','command',actionInput,stopOutput,'use',
  ['run','connection_stamp','capability_snapshot'],['run'],'runStop',true);
const api=[];
for(const op of operations)for(const audience of op.audiences){
  const shape=schemas.find(item=>item.id===op.input.schemaId).schema;
  api.push({id:`${audience}.${op.id}`,method:op.kind==='command'?'POST':'GET',
    path:`/api/${audience}/hermes/${op.id.replaceAll('.','/')}`,operation:ref('operation',op.id),audience,
    auth:['session','oauth','api-token'],parameters:op.kind==='command'?[]:
      Object.entries(shape.properties).filter(([,value])=>value.type==='string').map(([name])=>({name,in:'query',inputField:name,required:true})),
    input:op.input,output:op.output,rateLimit:{requests:30,windowSeconds:60}});
}
const widgetOperations={'capabilities.read':'capabilities','models.list':'models','run.read':'run'};
const tools=operations.map(op=>({id:op.id,name:`hermes_${op.id.replaceAll('.','_')}`,operation:ref('operation',op.id),
  audiences:op.audiences,auth:['oauth','api-token'],input:op.input,output:op.output,
  ...(widgetOperations[op.id]?{widget:ref('widget',widgetOperations[op.id])}:{}),
  annotations:{readOnly:op.kind==='query',destructive:op.id==='config.key.revoke',idempotent:op.kind==='query',
    openWorld:op.effects.providers.length>0},textFallback:true}));
const widgets=Object.entries(widgetOperations).map(([operationId,name])=>{
  const source=operations.find(op=>op.id===operationId);
  return {id:name,version:'1.0.0',compatibility:'^1.0.0',resource:`${name}-ui`,
    renderer:{path:'ui/widgets/runtime.ts',export:'startHermesWidget'},input:source.output,
    state:empty,result:source.output,audiences:source.audiences,
    permissions:[ref('permission',name==='run'?'use':'manage')],requiredCapabilities:[],assets:[],
    actions:[{id:'read',label:'Relire',input:source.input,requiredCapabilities:[],fallback:'unavailable',
      mode:'direct',target:{kind:'operation',operation:ref('operation',operationId)}}],
    instance:{identity:'host-generated',revision:'monotonic',correlation:'request-instance-conversation',
      objectVersion:'distinct',lateResponse:'reject-stale'},
    transport:{protocol:'mcp-apps',maxPayloadBytes:131072,timeoutMs:15000,
      uncertainResult:'reconcile-before-retry',fallbackDispatch:'before-first-dispatch-only'}};
});
const widgetResources=widgets.map(widget=>({id:`${widget.id}-ui`,uri:`ui://${id}/${widget.id}`,
  mimeType:'text/html;profile=mcp-app',audiences:widget.audiences,permissions:widget.permissions,
  source:{kind:'asset',path:`ui/widgets/${widget.id}.html`},widget:ref('widget',widget.id),
  ui:{csp:{connectDomains:[],resourceDomains:[],frameDomains:[],baseUriDomains:[]},
    permissions:{},prefersBorder:true}}));
m.identity={id,title:'Connecteur Hermes externe',publisher:'creezio',origin:'https://github.com/creezio/Creezio-D1R2',
  version,source:{kind:'snapshot',revision,integrity:`sha256-${createHash('sha256').update(revision).digest('hex')}`},
  license:{expression:'NOASSERTION',file:'LICENSE'}};
m.compatibility={core:'^0.0.0',sdk:'^1.6.0',requiredCapabilities:['runtime.worker','data.d1.shared'],optionalCapabilities:[]};
m.entrypoints={server:{path:'module/entry.server.ts',export:'hermes'},ui:{path:'ui/index.tsx',export:'HermesAdminView'},
  plugin:{manifest:'plugin/plugin.json',mcp:'plugin/mcp.json',contributions:{path:'plugin/contributions.ts',export:'contributions'}}};
m.dependencies=[{moduleId:'creezio.access',origin:m.identity.origin,versionRange:'^0.0.0',optional:false,
  contracts:[],whenAbsent:'block',whenIncompatible:'block',autoInstall:false}];
m.contracts={schemas,models,files:[],events:[],connectors:[structuredClone(hermesConnectorDescriptor)],settings:[
  {id:'api-key-ref',title:'Référence de clé API Hermes',schema:schema('key-reference-setting',str(128)),
    visibility:'secret-reference',required:false,permissions:[ref('permission','manage')],provider:connectorId,redact:true},
  {id:'origin',title:'Origine HTTPS Hermes',schema:schema('origin-setting',str(512)),visibility:'server',
    required:true,permissions:[ref('permission','manage')],provider:connectorId,redact:true}],
  search:[],permissions,operations,api,mcp:{tools,resources:widgetResources,prompts:[],skills:[]},
  ui:{views:[{id:'admin',title:'Hermes',surfaces:['workspace'],route:'/admin/hermes',
    component:{path:'ui/index.tsx',export:'HermesAdminView'},permissions:[ref('permission','manage'),
      ref('permission','use'),ref('permission','connect')],
    operations:operations.map(op=>ref('operation',op.id)),input:viewInput,
    panel:{identityFields:[],navigation:'sdk',retention:'preserve',inactiveEffects:'suspend',stateSchema:panelState}},
    {id:'app',title:'Mes runs Hermes',surfaces:['workspace'],route:'/app/hermes',
      component:{path:'ui/index.tsx',export:'HermesAdminView'},permissions:[ref('permission','use'),ref('permission','connect')],
      operations:operations.filter(op=>op.id.startsWith('run.')).map(op=>ref('operation',op.id)),input:viewInput,
      panel:{identityFields:[],navigation:'sdk',retention:'preserve',inactiveEffects:'suspend',stateSchema:panelState}}],
    navigation:[{id:'hermes-admin',title:'Hermes',view:ref('view','admin'),permissions:[ref('permission','manage'),
      ref('permission','use'),ref('permission','connect')],surfaces:['workspace'],order:79},
      {id:'hermes-app',title:'Mes runs Hermes',view:ref('view','app'),permissions:[ref('permission','use'),
        ref('permission','connect')],surfaces:['workspace'],order:80}],slots:[],front:{mode:'absent',justification:{reason:'Hermes configuration and runs live in workspace.',policyRule:'hermes.workspace-only'}},themes:[],styles:[]},
  widgets,publicContracts:[]};
m.documentation.versionBinding={moduleVersion:version,sourceRevision:revision};
for(const suite of ['backend','ui','api-mcp','widgets','package','docs'])m.validation.suites[suite].tests=[`tests/${suite}/contract.test.mjs`];
m.validation.suites.widgets.mode='required';delete m.validation.suites.widgets.justification;
m.packaging.runtime.files=['module/manifest.json','module/models.json','module/entry.server.ts','module/storage.ts',
  'module/operations.ts','module/service.ts','ui/index.tsx','ui/panel-state.ts','ui/widgets/runtime.ts',
  'ui/widgets/model.ts',
  ...widgets.map(widget=>`ui/widgets/${widget.id}.html`),'README.md','prd.md','CHANGELOG.md',
  'LICENSE','plugin/plugin.json','plugin/mcp.json','plugin/contributions.ts'];
m.packaging.validation.files=['AGENTS.md','FILES.md','interview.md','TODO.md','gate.mjs','module/generate-manifest.mjs',
  'ci/run-suite.mjs','tests/helpers.mjs',...['backend','ui','api-mcp','widgets','package','docs'].flatMap(name=>
    [`ci/${name}.mjs`,`tests/${name}/contract.test.mjs`])];
m.packaging.validationBinding={moduleId:id,moduleVersion:version,sourceRevision:revision};
m.lifecycle.absent={files:{reason:'Hermes files stay at the external service.',policyRule:'hermes.no-files'}};
m.lifecycle.configuration='explicit-state';
writeFileSync(new URL('module/models.json',root),JSON.stringify(models,null,2)+'\n');
writeFileSync(new URL('module/manifest.json',root),JSON.stringify(m,null,2)+'\n');
