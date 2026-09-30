import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {n8nConnectorDescriptor,n8nWebhookDescriptor} from './storage.ts';

const root=new URL('../',import.meta.url);
const template=JSON.parse(readFileSync(new URL('module/manifest.json',root),'utf8'));
const id='creezio.n8n',connectorId='n8n.api.v1',webhookConnectorId='n8n.webhook.v1',
  version='0.2.0',revision='t26-n8n-production-webhook-v1';
const ref=(kind,name)=>({moduleId:id,kind,id:name});
const str=(max=128,min=1)=>({type:'string',minLength:min,maxLength:max});
const num=(min=0,max=Number.MAX_SAFE_INTEGER)=>({type:'integer',minimum:min,maximum:max});
const nullable=value=>({anyOf:[value,{type:'null'}]});
const obj=(properties,required=Object.keys(properties))=>({type:'object',properties,required,additionalProperties:false});
const field=(id,type,options={})=>({id,type,nullable:options.nullable??false,
  protected:options.protected??false,computed:false,...(options.constraints?{constraints:options.constraints}:{})});
const model=(name,title,fields,permissions)=>({id:name,title,scope:'context',contextField:'context_id',
  fields:[field('context_id','string',{protected:true,constraints:{minLength:1,maxLength:128}}),...fields],
  primaryKey:['context_id','id'],indexes:[],relations:[],permissions:permissions.map(name=>ref('permission',name)),
  deletion:{mode:'soft',requiresApproval:false},public:false});
const models=[model('connector_config','Configuration n8n',[field('id','string',{constraints:{minLength:1,maxLength:128}}),
  field('origin','string',{constraints:{minLength:8,maxLength:512}}),
  field('key_ref','string',{nullable:true,constraints:{minLength:1,maxLength:128}}),
  field('secret_version','integer',{nullable:true,constraints:{minimum:1}}),field('enabled','boolean'),
  field('revision','integer',{constraints:{minimum:1}}),field('updated_at','date-time')],['manage','read','trigger']),
  model('connector_secret','Secret n8n scellé',[field('id','string',{protected:true,constraints:{minLength:1,maxLength:128}}),
    field('binding_id','string',{protected:true,constraints:{minLength:1,maxLength:128}}),
    field('ciphertext','string',{protected:true,constraints:{minLength:1,maxLength:32768}}),
    field('key_id','string',{protected:true,constraints:{minLength:1,maxLength:128}}),
    field('version','integer',{protected:true,constraints:{minimum:1}}),
    field('state','string',{protected:true,constraints:{enum:['active','revoked']}})],['manage','read','trigger']),
  model('webhook_config','Configuration du webhook de production n8n',[
    field('id','string',{constraints:{minLength:1,maxLength:128}}),
    field('origin','string',{constraints:{minLength:8,maxLength:512}}),
    field('path_id','string',{constraints:{minLength:1,maxLength:128}}),
    field('workflow_id','string',{constraints:{minLength:1,maxLength:128}}),
    field('key_ref','string',{nullable:true,constraints:{minLength:1,maxLength:128}}),
    field('secret_version','integer',{nullable:true,constraints:{minimum:1}}),
    field('enabled','boolean'),field('revision','integer',{constraints:{minimum:1}}),
    field('updated_at','date-time')],['manage','trigger']),
  model('webhook_secret','Secret webhook scellé',[
    field('id','string',{protected:true,constraints:{minLength:1,maxLength:128}}),
    field('binding_id','string',{protected:true,constraints:{minLength:1,maxLength:128}}),
    field('ciphertext','string',{protected:true,constraints:{minLength:1,maxLength:32768}}),
    field('key_id','string',{protected:true,constraints:{minLength:1,maxLength:128}}),
    field('version','integer',{protected:true,constraints:{minimum:1}}),
    field('state','string',{protected:true,constraints:{enum:['active','revoked']}})],['manage','trigger']),
  model('run','Intention et suivi n8n',[
    field('id','string',{constraints:{minLength:1,maxLength:128}}),
    field('principal_id','string',{constraints:{minLength:1,maxLength:128}}),
    field('audience','string',{constraints:{enum:['admin','app']}}),
    field('workflow_id','string',{constraints:{minLength:1,maxLength:128}}),
    field('path_id','string',{constraints:{minLength:1,maxLength:128}}),
    field('webhook_origin','string',{constraints:{minLength:8,maxLength:512}}),
    field('webhook_revision','integer',{constraints:{minimum:1}}),
    field('input','json'),
    field('status','string',{constraints:{enum:['prepared','accepted']}}),
    field('remote_execution_id','string',{nullable:true,constraints:{minLength:1,maxLength:128}}),
    field('remote_status','string',{nullable:true,constraints:{minLength:1,maxLength:64}}),
    field('revision','integer',{constraints:{minimum:1}}),
    field('created_at','date-time'),field('updated_at','date-time')],['manage','trigger'])];
const schemas=[],schema=(name,value)=>{schemas.push({id:name,schema:value});return {schemaId:name};};
const requestKey=str(128),revField=num(0),remoteId=str(128),cursor=str(2048),limit=num(1,25);
const configView=obj({origin:nullable(str(512)),enabled:{type:'boolean'},hasKey:{type:'boolean'},
  state:{type:'string',enum:['missing','configured','unavailable','unverified']},revision:revField});
const configOutput=schema('config-output',obj({config:configView}));
const empty=schema('empty-input',obj({}));
const configInput=schema('config-set-input',obj({requestKey,origin:str(512),enabled:{type:'boolean'},revision:revField}));
const keyInput=schema('config-key-set-input',obj({requestKey,apiKey:str(4096,8),revision:revField}));
const keyRevokeInput=schema('config-key-revoke-input',obj({requestKey,revision:revField}));
const workflow=obj({id:remoteId,name:str(4096,0),active:{type:'boolean'},isArchived:{type:'boolean'},
  createdAt:nullable(str(64)),updatedAt:nullable(str(64)),versionId:nullable(str(128))});
const execution=obj({id:remoteId,workflowId:nullable(remoteId),status:str(64),mode:nullable(str(64)),
  startedAt:nullable(str(64)),stoppedAt:nullable(str(64))});
const pageInput=schema('page-input',obj({limit,cursor},['limit']));
const idInput=schema('id-input',obj({id:remoteId}));
const workflowListOutput=schema('workflow-list-output',obj({items:{type:'array',items:workflow,maxItems:25},nextCursor:nullable(cursor)}));
const workflowOutput=schema('workflow-output',obj({workflow}));
const executionListOutput=schema('execution-list-output',obj({items:{type:'array',items:execution,maxItems:25},nextCursor:nullable(cursor)}));
const executionOutput=schema('execution-output',obj({execution}));
const checkOutput=schema('check-output',obj({reachable:{const:true}}));
const webhookView=obj({origin:nullable(str(512)),pathId:nullable(remoteId),workflowId:nullable(remoteId),
  enabled:{type:'boolean'},hasKey:{type:'boolean'},revision:revField});
const webhookOutput=schema('webhook-config-output',obj({config:webhookView}));
const webhookInput=schema('webhook-config-set-input',obj({requestKey,origin:str(512),pathId:remoteId,
  workflowId:remoteId,enabled:{type:'boolean'},revision:revField}));
const webhookKeyInput=schema('webhook-key-set-input',obj({requestKey,webhookKey:str(4096,8),revision:revField}));
const runView=obj({id:remoteId,workflowId:remoteId,status:{type:'string',enum:['prepared','accepted']},
  remoteExecutionId:nullable(remoteId),remoteStatus:nullable(str(64)),revision:num(1),
  createdAt:str(64),updatedAt:str(64)});
const runOutput=schema('run-output',obj({run:runView}));
const runInput=schema('run-prepare-input',obj({requestKey,input:{type:'object',maxProperties:32,
  additionalProperties:true}}));
const runIdInput=schema('run-id-input',obj({id:remoteId}));
const runActionInput=schema('run-action-input',obj({requestKey,id:remoteId,revision:num(1)}));
const runRefreshInput=schema('run-refresh-input',obj({requestKey,id:remoteId,revision:num(1)}));
const panelState=schema('n8n-panel-state',obj({sessionId:str(128),audience:{type:'string',enum:['admin','app']},
  contextId:str(128),tab:{type:'string',enum:['workflows','executions','settings']},
  workflowCursor:cursor,executionCursor:cursor,pending:obj({sessionId:str(128),audience:{type:'string',enum:['admin','app']},
    contextId:str(128),bindingId:str(257),requestKey:str(512),intent:str(64),targetId:remoteId},
    ['sessionId','audience','contextId','bindingId','requestKey'])},[]));
const runPanelState=schema('n8n-run-panel-state',obj({sessionId:str(128),
  audience:{type:'string',enum:['admin','app']},contextId:str(128),runId:remoteId,
  pending:obj({sessionId:str(128),audience:{type:'string',enum:['admin','app']},
    contextId:str(128),bindingId:str(257),requestKey:str(512),intent:str(64),targetId:remoteId},
    ['sessionId','audience','contextId','bindingId','requestKey'])},
  ['sessionId','audience','contextId']));
const viewInput=schema('n8n-view-input',obj({}));
const permissions=[{id:'manage',title:'Configurer le connecteur n8n',audiences:['admin'],
  actors:['user','delegated-user','machine'],scopes:['n8n.manage'],context:'required',default:'deny',
  resources:models.map(model=>ref('model',model.id)),actions:['read','create','update','execute'],
  enforcement:{request:true,commit:true},public:false},
{id:'read',title:'Lire les métadonnées n8n',audiences:['admin','app'],actors:['user','delegated-user','machine'],
  scopes:['n8n.read'],context:'required',default:'deny',resources:[ref('model','connector_config'),
    ref('model','connector_secret')],
  actions:['read','execute'],enforcement:{request:true,commit:true},public:false},
{id:'trigger',title:'Déclencher et suivre un workflow n8n',audiences:['admin','app'],
  actors:['user','delegated-user','machine'],scopes:['n8n.trigger'],context:'required',default:'deny',
  resources:[ref('model','webhook_config'),ref('model','webhook_secret'),ref('model','run'),
    ref('model','connector_config'),ref('model','connector_secret')],
  actions:['read','create','update','execute'],enforcement:{request:true,commit:true},public:false}];
const errors=['invalid_input','unauthorized','forbidden','not_found','conflict','rate_limited','unsupported','unavailable','unknown']
  .map(code=>({code,retryable:['rate_limited','unavailable','unknown'].includes(code),
    outcome:code==='unknown'?'unknown':'rejected'}));
const operations=[];
function operation(name,title,kind,input,output,permission,reads,writes,options={}){
  const command=kind==='command';
  operations.push({id:name,title,kind,input,output,permissions:[ref('permission',permission)],
    audiences:permission==='manage'?['admin']:['admin','app'],actors:['user','delegated-user','machine'],
    context:'required',handler:{path:'module/operations.ts',export:options.exportName},
    effects:{reads:reads.map(name=>ref('model',name)),writes:writes.map(name=>ref('model',name)),
      emits:[],calls:[],providers:options.provider?[options.provider]:options.remote?[connectorId]:[]},errors,
    pagination:options.pagination??{mode:'none'},
    idempotency:command?{mode:'required',keyField:'requestKey',scope:'actor-context-operation',retentionSeconds:86400}:{mode:'none'},
    approval:{mode:'none'},concurrency:options.cas?{mode:'object-version',versionField:'revision'}:{mode:'none'},
    execution:{maxDurationMs:10000,maxItems:options.maxItems??4,resumable:false},
    audit:{required:true,redactFields:['apiKey','webhookKey','input']},public:false});
}
operation('config.read','Lire la configuration n8n','query',empty,configOutput,'manage',['connector_config'],[],{exportName:'configRead'});
operation('config.set','Configurer l’instance n8n','command',configInput,configOutput,'manage',
  ['connector_config','webhook_config'],['connector_config','webhook_config'],{exportName:'configSet'});
operation('config.key.set','Enregistrer la clé API n8n','command',keyInput,configOutput,'manage',
  ['connector_config','connector_secret'],['connector_config','connector_secret'],{exportName:'configKeySet',cas:true});
operation('config.key.revoke','Révoquer la clé API n8n','command',keyRevokeInput,configOutput,'manage',
  ['connector_config','connector_secret','webhook_config'],
  ['connector_config','connector_secret','webhook_config'],{exportName:'configKeyRevoke',maxItems:5});
operation('connection.check','Vérifier la connexion n8n','query',empty,checkOutput,'manage',
  ['connector_config'],[],{exportName:'connectionCheck',remote:true});
operation('workflow.list','Lister les workflows n8n','query',pageInput,workflowListOutput,'read',
  ['connector_config'],[],{exportName:'workflowList',remote:true,
    pagination:{mode:'cursor',cursorField:'cursor',limitField:'limit',maxItems:25},maxItems:27});
operation('workflow.read','Lire un workflow n8n','query',idInput,workflowOutput,'read',
  ['connector_config'],[],{exportName:'workflowRead',remote:true});
operation('execution.list','Lister les exécutions n8n','query',pageInput,executionListOutput,'read',
  ['connector_config'],[],{exportName:'executionList',remote:true,
    pagination:{mode:'cursor',cursorField:'cursor',limitField:'limit',maxItems:25},maxItems:27});
operation('execution.read','Lire une exécution n8n','query',idInput,executionOutput,'read',
  ['connector_config'],[],{exportName:'executionRead',remote:true});
operation('config.webhook.read','Lire la configuration webhook','query',empty,webhookOutput,'manage',
  ['webhook_config'],[],{exportName:'webhookConfigRead'});
operation('config.webhook.set','Configurer le webhook de production','command',webhookInput,webhookOutput,
  'manage',['webhook_config'],['webhook_config'],{exportName:'webhookConfigSet'});
operation('config.key.webhook.set','Enregistrer la clé webhook','command',webhookKeyInput,webhookOutput,
  'manage',['webhook_config','webhook_secret'],['webhook_config','webhook_secret'],
  {exportName:'webhookKeySet',cas:true});
operation('config.key.webhook.revoke','Révoquer la clé webhook','command',keyRevokeInput,webhookOutput,
  'manage',['webhook_config','webhook_secret'],['webhook_config','webhook_secret'],
  {exportName:'webhookKeyRevoke',cas:true});
operation('run.prepare','Préparer une intention n8n','command',runInput,runOutput,'trigger',
  ['webhook_config','connector_config'],['run'],{exportName:'runPrepare'});
operation('run.read','Lire une intention n8n','query',runIdInput,runOutput,'trigger',
  ['run'],[],{exportName:'runRead'});
operation('run.trigger','Déclencher le webhook de production','command',runActionInput,runOutput,'trigger',
  ['run','webhook_config','webhook_secret','connector_config'],['run'],
  {exportName:'runTrigger',provider:webhookConnectorId,cas:true,maxItems:9});
operation('run.refresh','Actualiser le statut de l’exécution','command',runRefreshInput,runOutput,'trigger',
  ['run','connector_config','connector_secret'],['run'],
  {exportName:'runRefresh',provider:connectorId,cas:true,maxItems:7});
const api=[];
for(const op of operations)for(const audience of op.audiences){
  const definition=schemas.find(item=>item.id===op.input.schemaId).schema;
  api.push({id:`${audience}.${op.id}`,method:op.kind==='command'?'POST':'GET',
    path:`/api/${audience}/n8n/${op.id.replaceAll('.','/')}`,operation:ref('operation',op.id),audience,
    auth:['session','oauth','api-token'],parameters:op.kind==='command'?[]:
      Object.entries(definition.properties).filter(([,value])=>['string','integer','boolean'].includes(value.type))
        .map(([name])=>({name,in:'query',inputField:name,required:definition.required.includes(name)})),
    input:op.input,output:op.output,rateLimit:{requests:30,windowSeconds:60}});
}
const mcpTools=operations.map(op=>({id:op.id,name:`n8n_${op.id.replaceAll('.','_')}`,
  operation:ref('operation',op.id),audiences:op.audiences,auth:['oauth','api-token'],input:op.input,output:op.output,
  ...(({'workflow.list':'workflows','run.read':'run'})[op.id]
    ?{widget:ref('widget',({'workflow.list':'workflows','run.read':'run'})[op.id])}:{}),
  annotations:{readOnly:op.kind==='query',destructive:op.id==='config.key.revoke',
    idempotent:op.kind==='query',openWorld:op.effects.providers.length>0},textFallback:true}));
const widget=(name,sourceName)=>{
  const source=operations.find(op=>op.id===sourceName);
  return {id:name,version:'1.0.0',compatibility:'^1.0.0',resource:`${name}-ui`,
    renderer:{path:'ui/widgets/panels.ts',export:'startN8nWidget'},input:source.output,
    state:empty,result:source.output,audiences:source.audiences,
    permissions:[ref('permission',name==='run'?'trigger':'read')],requiredCapabilities:[],assets:[],
    actions:[{id:'refresh',label:'Relire',input:source.input,requiredCapabilities:[],
      fallback:'unavailable',mode:'direct',target:{kind:'operation',operation:ref('operation',sourceName)}}],
    instance:{identity:'host-generated',revision:'monotonic',correlation:'request-instance-conversation',
      objectVersion:'distinct',lateResponse:'reject-stale'},
    transport:{protocol:'mcp-apps',maxPayloadBytes:65536,timeoutMs:15000,
      uncertainResult:'reconcile-before-retry',fallbackDispatch:'before-first-dispatch-only'}};
};
const widgets=[widget('workflows','workflow.list'),widget('run','run.read')];
const widgetResources=widgets.map(widget=>({id:`${widget.id}-ui`,uri:`ui://${id}/${widget.id}`,
  mimeType:'text/html;profile=mcp-app',audiences:widget.audiences,permissions:widget.permissions,
  source:{kind:'asset',path:`ui/widgets/${widget.id}.html`},widget:ref('widget',widget.id),
  ui:{csp:{connectDomains:[],resourceDomains:[],frameDomains:[],baseUriDomains:[]},
    permissions:{},prefersBorder:true}}));
const m=structuredClone(template);
m.identity={id,title:'Connecteur n8n externe',publisher:'creezio',origin:'https://github.com/creezio/Creezio-D1R2',
  version,source:{kind:'snapshot',revision,integrity:`sha256-${createHash('sha256').update(revision).digest('hex')}`},
  license:{expression:'NOASSERTION',file:'LICENSE'}};
m.compatibility={core:'^0.0.0',sdk:'^1.6.0',requiredCapabilities:['runtime.worker','data.d1.shared'],optionalCapabilities:[]};
m.entrypoints={server:{path:'module/entry.server.ts',export:'n8n'},ui:{path:'ui/index.tsx',export:'N8nAdminView'},
  plugin:{manifest:'plugin/plugin.json',mcp:'plugin/mcp.json',
    contributions:{path:'plugin/contributions.ts',export:'contributions'}}};
m.dependencies=[{moduleId:'creezio.access',origin:m.identity.origin,versionRange:'^0.0.0',optional:false,
  contracts:[],whenAbsent:'block',whenIncompatible:'block',autoInstall:false}];
m.contracts={schemas,models,files:[],events:[],connectors:[structuredClone(n8nConnectorDescriptor),
  structuredClone(n8nWebhookDescriptor)],settings:[
  {id:'api-key-ref',title:'Référence de clé API n8n',schema:schema('key-reference-setting',str(128)),
    visibility:'secret-reference',required:false,permissions:[ref('permission','manage')],provider:connectorId,redact:true},
  {id:'origin',title:'URL de l’instance n8n',schema:schema('origin-setting',str(512)),visibility:'server',
    required:true,permissions:[ref('permission','manage')],provider:connectorId,redact:true},
  {id:'webhook-key-ref',title:'Référence de clé webhook',schema:schema('webhook-key-reference-setting',str(128)),
    visibility:'secret-reference',required:false,permissions:[ref('permission','manage')],
    provider:webhookConnectorId,redact:true}],
  search:[],permissions,operations,api,mcp:{tools:mcpTools,resources:widgetResources,prompts:[],skills:[]},
  ui:{views:[{id:'admin',title:'n8n',surfaces:['workspace'],route:'/admin/n8n',
    component:{path:'ui/index.tsx',export:'N8nAdminView'},permissions:[ref('permission','manage')],
    operations:operations.filter(op=>op.audiences.includes('admin')).map(op=>ref('operation',op.id)),input:viewInput,
    panel:{identityFields:[],navigation:'sdk',retention:'preserve',inactiveEffects:'suspend',stateSchema:panelState}},
    {id:'runs',title:'Déclenchement n8n',surfaces:['workspace'],route:'/n8n/runs',
      component:{path:'ui/runs.tsx',export:'N8nRunView'},permissions:[ref('permission','trigger')],
      operations:['run.prepare','run.read','run.trigger','run.refresh'].map(op=>ref('operation',op)),
      input:viewInput,panel:{identityFields:[],navigation:'sdk',retention:'preserve',
        inactiveEffects:'suspend',stateSchema:runPanelState}}],
    navigation:[{id:'n8n-admin',title:'n8n',view:ref('view','admin'),permissions:[ref('permission','manage')],
      surfaces:['workspace'],order:78},{id:'n8n-runs',title:'Déclencher n8n',view:ref('view','runs'),
      permissions:[ref('permission','trigger')],surfaces:['workspace'],order:79}],slots:[],front:{mode:'absent',justification:{reason:'n8n settings and runs belong to workspace; API and MCP serve other clients.',
      policyRule:'n8n.workspace-only'}},themes:[],styles:[]},widgets:[],publicContracts:[]};
m.documentation.versionBinding={moduleVersion:version,sourceRevision:revision};
for(const suite of ['backend','ui','api-mcp','widgets','package','docs'])m.validation.suites[suite].tests=[`tests/${suite}/contract.test.mjs`];
m.validation.suites.backend.tests.push('tests/backend/webhook.test.mjs');
m.contracts.widgets=widgets;
m.validation.suites.widgets.mode='required';
delete m.validation.suites.widgets.justification;
m.packaging.runtime.files=['module/manifest.json','module/models.json','module/entry.server.ts','module/storage.ts',
  'module/operations.ts','module/service.ts','module/webhook.ts','module/runs.ts',
  'ui/index.tsx','ui/panel-state.ts','ui/runs.tsx','ui/widgets/panels.ts','ui/widgets/model.ts',
  'ui/widgets/workflows.html','ui/widgets/run.html','README.md','prd.md','CHANGELOG.md',
  'LICENSE','plugin/plugin.json','plugin/mcp.json','plugin/contributions.ts'];
m.packaging.validation.files=['AGENTS.md','FILES.md','interview.md','TODO.md','gate.mjs',
  'module/generate-manifest.mjs','ci/run-suite.mjs','tests/helpers.mjs',
  'tests/backend/webhook.test.mjs',
  ...['backend','ui','api-mcp','widgets','package','docs'].flatMap(name=>
    [`ci/${name}.mjs`,`tests/${name}/contract.test.mjs`])];
m.packaging.validationBinding={moduleId:id,moduleVersion:version,sourceRevision:revision};
m.lifecycle.absent={files:{reason:'n8n stores its own workflow assets; this connector has no R2 category.',policyRule:'n8n.no-files'}};
m.lifecycle.configuration='explicit-state';
writeFileSync(new URL('module/models.json',root),JSON.stringify(models,null,2)+'\n');
writeFileSync(new URL('module/manifest.json',root),JSON.stringify(m,null,2)+'\n');
