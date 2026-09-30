import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {meiliConnectorDescriptor} from './storage.ts';

const root=new URL('../',import.meta.url);
const template=JSON.parse(readFileSync(new URL('module/manifest.json',root),'utf8'));
const id='creezio.meili',connectorId='meili.api.v1',version='0.3.0',revision='t28-meili-projection-v1';
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
const models=[model('connector_config','Configuration Meili',[field('id','string',{constraints:{minLength:1,maxLength:128}}),
  field('origin','string',{constraints:{minLength:8,maxLength:512}}),
  field('key_ref','string',{nullable:true,constraints:{minLength:1,maxLength:128}}),
  field('secret_version','integer',{nullable:true,constraints:{minimum:1}}),field('enabled','boolean'),
  field('revision','integer',{constraints:{minimum:1}}),field('updated_at','date-time')],['manage','read','search']),
  model('connector_secret','Secret Meili scellé',[field('id','string',{protected:true,constraints:{minLength:1,maxLength:128}}),
    field('binding_id','string',{protected:true,constraints:{minLength:1,maxLength:128}}),
    field('ciphertext','string',{protected:true,constraints:{minLength:1,maxLength:32768}}),
    field('key_id','string',{protected:true,constraints:{minLength:1,maxLength:128}}),
    field('version','integer',{protected:true,constraints:{minimum:1}}),
    field('state','string',{protected:true,constraints:{enum:['active','revoked']}})],['manage','read','search']),
  model('index_job','Projection Meili par source',[field('id','string',{constraints:{minLength:1,maxLength:257}}),
    field('active_uid','string',{nullable:true,constraints:{minLength:1,maxLength:64}}),
    field('active_epoch','string',{nullable:true,constraints:{minLength:1,maxLength:64}}),
    field('abandoned_uid','string',{nullable:true,constraints:{minLength:1,maxLength:64}}),
    field('building_uid','string',{nullable:true,constraints:{minLength:1,maxLength:64}}),
    field('building_epoch','string',{nullable:true,constraints:{minLength:1,maxLength:64}}),
    field('mode','string',{constraints:{enum:['rebuild','sync']}}),
    field('building_count','integer',{constraints:{minimum:0}}),
    field('cursor','string',{nullable:true,constraints:{minLength:1,maxLength:2048}}),
    field('pending_cursor','string',{nullable:true,constraints:{minLength:1,maxLength:2048}}),
    field('pending_records','json',{nullable:true}),
    field('pending_payload','json',{nullable:true}),
    field('pending_kind','string',{nullable:true,constraints:{enum:['upsert','delete',null]}}),
    field('emit_key','string',{nullable:true,constraints:{minLength:1,maxLength:128}}),
    field('pending_task_uid','integer',{nullable:true,constraints:{minimum:0}}),
    field('state','string',{constraints:{enum:['building','prepared','waiting','failed','ready']}}),
    field('config_revision','integer',{constraints:{minimum:1}}),
    field('revision','integer',{constraints:{minimum:1}}),field('updated_at','date-time')],['manage','search']),
  model('index_projection','Révision synchronisée de document',[field('id','string',
    {constraints:{minLength:1,maxLength:256}}),field('source_id','string',{constraints:{minLength:1,maxLength:257}}),
    field('epoch','string',{constraints:{minLength:1,maxLength:64}}),
    field('record_id','string',{constraints:{minLength:1,maxLength:128}}),
    field('source_revision','integer',{constraints:{minimum:1}}),
    field('deleted','boolean'),field('revision','integer',{constraints:{minimum:1}}),
    field('updated_at','date-time')],['manage'])];
const schemas=[],schema=(name,value)=>{schemas.push({id:name,schema:value});return {schemaId:name};};
const requestKey=str(128),revField=num(0);
const configView=obj({origin:nullable(str(512)),enabled:{type:'boolean'},hasKey:{type:'boolean'},
  state:{type:'string',enum:['missing','configured','unverified']},revision:revField});
const configOutput=schema('config-output',obj({config:configView}));
const empty=schema('empty-input',obj({}));
const configInput=schema('config-set-input',obj({requestKey,origin:str(512),enabled:{type:'boolean'},revision:revField}));
const keyInput=schema('config-key-set-input',obj({requestKey,apiKey:str(4096,8),revision:revField}));
const keyRevokeInput=schema('config-key-revoke-input',obj({requestKey,revision:revField}));
const checkOutput=schema('check-output',obj({authenticated:{type:'boolean'},
  status:{type:'string',enum:['connected','key_rejected']}}));
const indexListInput=schema('index-list-input',obj({limit:num(1,20),cursor:str(6)},[]));
const indexListOutput=schema('index-list-output',obj({items:{type:'array',maxItems:20,
  items:obj({uid:str(400),primaryKey:nullable(str(400)),createdAt:str(64),updatedAt:str(64)})},
  total:num(),nextCursor:nullable(str(6))}));
const indexReadInput=schema('index-read-input',obj({source:str(257)},[]));
const indexCommandInput=schema('index-command-input',obj({requestKey:str(128),revision:revField,
  source:str(257)},['requestKey','revision']));
const indexAbandonInput=schema('index-abandon-input',obj({requestKey:str(128),revision:revField,
  source:str(257),acknowledgeUnknown:{const:true}},['requestKey','revision','acknowledgeUnknown']));
const indexView=obj({state:{type:'string',enum:['missing','building','prepared','waiting','failed','ready']},
  revision:revField,active:nullable(str(64)),building:nullable(str(64)),abandoned:nullable(str(64)),
  preparedCount:num(0,13),emitKey:nullable(str(128)),taskUid:nullable(num())});
const indexOutput=schema('index-output',obj({index:indexView}));
const indexReadOutput=schema('index-read-output',obj({index:indexView,
  sources:{type:'array',maxItems:1000,uniqueItems:true,items:str(257)}}));
const searchInput=schema('index-search-input',obj({q:str(256,0),limit:num(1,20),offset:num(0,1000),
  source:str(257)},['q','limit','offset']));
const searchOutput=schema('index-search-output',obj({source:str(257),items:{type:'array',maxItems:20,
  items:obj({id:str(128),fields:{type:'object',additionalProperties:true}})},
  facets:{type:'array',maxItems:16,items:obj({field:str(128),values:{type:'array',maxItems:20,
    items:obj({value:str(256),count:num(1,20)})}})},
  pageCount:num(0,20),nextOffset:nullable(num(0,1000)),stale:{type:'boolean'}}));
const widgetState=schema('meili-widget-state',obj({source:str(257),query:str(256,0)},[]));
const panelState=schema('meili-panel-state',obj({sessionId:str(128),audience:{type:'string',enum:['admin','app']},
  contextId:str(128),
  pending:obj({sessionId:str(128),audience:{type:'string',enum:['admin','app']},
    contextId:str(128),bindingId:str(257),requestKey:str(512),intent:str(64),targetId:str(128)},
  ['sessionId','audience','contextId','bindingId','requestKey'])},[]));
const viewInput=schema('meili-view-input',obj({}));
const permissions=[{id:'manage',title:'Configurer le connecteur Meili',audiences:['admin'],
  actors:['user','delegated-user','machine'],scopes:['meili.manage'],context:'required',default:'deny',
  resources:models.map(model=>ref('model',model.id)),actions:['read','create','update','execute'],
  enforcement:{request:true,commit:true},public:false},
{id:'read',title:'Vérifier la connexion Meili',audiences:['admin'],actors:['user','delegated-user','machine'],
  scopes:['meili.read'],context:'required',default:'deny',resources:[ref('model','connector_config'),
    ref('model','connector_secret')],
  actions:['read','execute'],enforcement:{request:true,commit:true},public:false},
{id:'search',title:'Rechercher dans les projections publiées',audiences:['admin','app'],
  actors:['user','delegated-user','machine'],scopes:['meili.search'],context:'required',default:'deny',
  resources:[ref('model','connector_config'),ref('model','connector_secret'),ref('model','index_job')],
  actions:['read','execute'],enforcement:{request:true,commit:true},public:false}];
const errors=['invalid_input','unauthorized','forbidden','not_found','conflict','rate_limited','unsupported','unavailable','unknown']
  .map(code=>({code,retryable:['rate_limited','unavailable','unknown'].includes(code),
    outcome:code==='unknown'?'unknown':'rejected'}));
const operations=[];
function operation(name,title,kind,input,output,permission,reads,writes,options={}){
  const command=kind==='command';
  operations.push({id:name,title,kind,input,output,permissions:[ref('permission',permission)],
    audiences:options.audiences??['admin'],actors:['user','delegated-user','machine'],
    context:'required',handler:{path:'module/operations.ts',export:options.exportName},
    effects:{reads:reads.map(name=>ref('model',name)),writes:writes.map(name=>ref('model',name)),
      emits:[],calls:[],providers:options.remote?[connectorId]:[]},errors,
    pagination:options.pagination??{mode:'none'},
    idempotency:command?{mode:'required',keyField:'requestKey',scope:'actor-context-operation',retentionSeconds:86400}:{mode:'none'},
    approval:{mode:'none'},concurrency:options.cas?{mode:'object-version',versionField:'revision'}:{mode:'none'},
    execution:{maxDurationMs:options.maxDurationMs??10000,maxItems:options.maxItems??4,resumable:false},
    audit:{required:true,redactFields:['apiKey']},public:options.public===true});
}
operation('config.read','Lire la configuration Meili','query',empty,configOutput,'manage',['connector_config'],[],{exportName:'configRead'});
operation('config.set','Configurer l’instance Meili','command',configInput,configOutput,'manage',
  ['connector_config'],['connector_config'],{exportName:'configSet'});
operation('config.key.set','Enregistrer la clé API Meili','command',keyInput,configOutput,'manage',
  ['connector_config','connector_secret'],['connector_config','connector_secret'],{exportName:'configKeySet',cas:true});
operation('config.key.revoke','Révoquer la clé API Meili','command',keyRevokeInput,configOutput,'manage',
  ['connector_config','connector_secret'],['connector_config','connector_secret'],{exportName:'configKeyRevoke',cas:true});
operation('connection.check','Vérifier la connexion Meili','query',empty,checkOutput,'read',
  ['connector_config'],[],{exportName:'connectionCheck',remote:true});
operation('index.list','Lister les index du compte Meili','query',indexListInput,indexListOutput,'manage',
  ['connector_config'],[],{exportName:'indexList',remote:true,maxItems:22,
    pagination:{mode:'cursor',cursorField:'cursor',limitField:'limit',maxItems:20}});
operation('index.read','Lire la progression d’indexation','query',indexReadInput,indexReadOutput,'manage',
  ['index_job'],[],{exportName:'indexRead'});
operation('index.rebuild.start','Démarrer une nouvelle génération','command',indexCommandInput,indexOutput,'manage',
  ['connector_config','index_job'],['index_job'],{exportName:'indexRebuildStart',maxItems:8,public:true});
operation('index.sync.start','Démarrer un passage incrémental','command',indexCommandInput,indexOutput,'manage',
  ['connector_config','index_job'],['index_job'],{exportName:'indexSyncStart',maxItems:8,cas:true});
operation('index.prepare','Préparer un lot borné sans émettre','command',indexCommandInput,indexOutput,'manage',
  ['connector_config','index_job','index_projection'],['index_job'],
  {exportName:'indexPrepare',maxItems:120,maxDurationMs:30000,cas:true});
operation('index.emit','Émettre le lot préparé une seule fois','command',indexCommandInput,indexOutput,'manage',
  ['connector_config','index_job'],['index_job'],
  {exportName:'indexEmit',remote:true,maxItems:12,cas:true,public:true});
operation('index.reconcile','Confirmer une tâche fournisseur','command',indexCommandInput,indexOutput,'manage',
  ['connector_config','index_job','index_projection'],['index_job','index_projection'],
  {exportName:'indexReconcile',remote:true,maxItems:50});
operation('index.abandon','Abandonner explicitement une émission incertaine','command',indexAbandonInput,
  indexOutput,'manage',['index_job'],['index_job'],{exportName:'indexAbandon',maxItems:8,cas:true});
operation('index.search','Rechercher les produits publiés du contexte','query',searchInput,searchOutput,'search',
  ['connector_config','index_job'],[],{exportName:'indexSearch',remote:true,maxItems:8,
    audiences:['admin','app'],public:true});
const api=[];
for(const op of operations)for(const audience of op.audiences){
  const definition=schemas.find(item=>item.id===op.input.schemaId).schema;
  api.push({id:`${audience}.${op.id}`,method:op.kind==='command'?'POST':'GET',
    path:`/api/${audience}/meili/${op.id.replaceAll('.','/')}`,operation:ref('operation',op.id),audience,
    auth:['session','oauth','api-token'],parameters:op.kind==='command'?[]:
      Object.entries(definition.properties).filter(([,value])=>['string','integer','boolean'].includes(value.type))
        .map(([name])=>({name,in:'query',inputField:name,required:definition.required.includes(name)})),
    input:op.input,output:op.output,rateLimit:{requests:30,windowSeconds:60}});
}
const mcpTools=operations.map(op=>({id:op.id,name:`meili_${op.id.replaceAll('.','_')}`,
  operation:ref('operation',op.id),audiences:op.audiences,auth:['oauth','api-token'],input:op.input,output:op.output,
  annotations:{readOnly:op.kind==='query',destructive:op.id==='config.key.revoke',
    idempotent:op.kind==='query',openWorld:op.effects.providers.length>0},
  ...(op.id==='index.search'?{widget:ref('widget','search-results')}:{ }),textFallback:true}));
const widgetResource={id:'search-results-ui',uri:`ui://${id}/search-results`,
  mimeType:'text/html;profile=mcp-app',audiences:['admin','app'],permissions:[ref('permission','search')],
  source:{kind:'asset',path:'ui/widgets/search-results.html'},widget:ref('widget','search-results'),
  ui:{csp:{connectDomains:[],resourceDomains:[],frameDomains:[],baseUriDomains:[]},
    permissions:{},prefersBorder:true}};
const searchWidget={id:'search-results',version:'1.0.0',compatibility:'^1.0.0',
  resource:'search-results-ui',renderer:{path:'ui/widgets/search-results.ts',export:'startSearchResults'},
  input:searchOutput,state:widgetState,result:searchOutput,audiences:['admin','app'],
  permissions:[ref('permission','search')],requiredCapabilities:[],assets:[],
  actions:[{id:'search',label:'Rechercher',input:searchInput,requiredCapabilities:[],
    fallback:'unavailable',mode:'direct',target:{kind:'operation',operation:ref('operation','index.search')}}],
  instance:{identity:'host-generated',revision:'monotonic',correlation:'request-instance-conversation',
    objectVersion:'distinct',lateResponse:'reject-stale'},
  transport:{protocol:'mcp-apps',maxPayloadBytes:65536,timeoutMs:15000,
    uncertainResult:'reconcile-before-retry',fallbackDispatch:'before-first-dispatch-only'}};
const m=structuredClone(template);
m.identity={id,title:'Connecteur Meili externe',publisher:'creezio',origin:'https://github.com/creezio/Creezio-D1R2',
  version,source:{kind:'snapshot',revision,integrity:`sha256-${createHash('sha256').update(revision).digest('hex')}`},
  license:{expression:'NOASSERTION',file:'LICENSE'}};
m.compatibility={core:'^0.0.0',sdk:'^1.6.0',requiredCapabilities:['runtime.worker','data.d1.shared'],optionalCapabilities:[]};
m.entrypoints={server:{path:'module/entry.server.ts',export:'meili'},ui:{path:'ui/index.tsx',export:'MeiliAdminView'},
  plugin:{manifest:'plugin/plugin.json',mcp:'plugin/mcp.json',
    contributions:{path:'plugin/contributions.ts',export:'contributions'}}};
m.dependencies=[{moduleId:'creezio.access',origin:m.identity.origin,versionRange:'^0.0.0',optional:false,
  contracts:[],whenAbsent:'block',whenIncompatible:'block',autoInstall:false}];
m.contracts={schemas,models,files:[],events:[],connectors:[structuredClone(meiliConnectorDescriptor)],settings:[
  {id:'api-key-ref',title:'Référence de clé API Meili',schema:schema('key-reference-setting',str(128)),
    visibility:'secret-reference',required:false,permissions:[ref('permission','manage')],provider:connectorId,redact:true},
  {id:'origin',title:'URL de l’instance Meili',schema:schema('origin-setting',str(512)),visibility:'server',
    required:true,permissions:[ref('permission','manage')],provider:connectorId,redact:true}],
  search:[],permissions,operations,api,mcp:{tools:mcpTools,resources:[widgetResource],prompts:[],skills:[]},
  ui:{views:[{id:'admin',title:'Recherche Meili',surfaces:['workspace'],route:'/admin/meili',
    component:{path:'ui/index.tsx',export:'MeiliAdminView'},permissions:[ref('permission','manage')],
    operations:operations.map(op=>ref('operation',op.id)),input:viewInput,
    panel:{identityFields:[],navigation:'sdk',retention:'preserve',inactiveEffects:'suspend',stateSchema:panelState}}],
    navigation:[{id:'meili-admin',title:'Recherche Meili',view:ref('view','admin'),permissions:[ref('permission','manage')],
      surfaces:['workspace'],order:78}],slots:[],front:{mode:'absent',justification:{reason:'Meili settings belong to the administrative workspace; no public search is implemented.',
      policyRule:'meili.workspace-only'}},themes:[],styles:[]},widgets:[searchWidget],
  publicContracts:[{id:'meili.index',version:'1.0.0',models:[],
    operations:[ref('operation','index.rebuild.start'),ref('operation','index.emit'),
      ref('operation','index.search')],events:[],schemas:[indexCommandInput,indexOutput,
      searchInput,searchOutput]}]};
m.documentation.versionBinding={moduleVersion:version,sourceRevision:revision};
for(const suite of ['backend','ui','api-mcp','widgets','package','docs'])m.validation.suites[suite].tests=[`tests/${suite}/contract.test.mjs`];
m.validation.suites.backend.tests.push('tests/backend/task.test.mjs');
m.validation.suites.backend.tests.push('tests/backend/indexing.test.mjs');
m.validation.suites.widgets.mode='required';delete m.validation.suites.widgets.justification;
m.packaging.runtime.files=['module/manifest.json','module/models.json','module/entry.server.ts','module/storage.ts',
  'module/operations.ts','module/service.ts','module/indexing.ts','module/task.ts',
  'ui/index.tsx','ui/panel-state.ts','ui/widgets/search-results.ts','ui/widgets/search-results.html',
  'README.md','prd.md','CHANGELOG.md',
  'LICENSE','plugin/plugin.json','plugin/mcp.json','plugin/contributions.ts'];
m.packaging.validation.files=['AGENTS.md','FILES.md','interview.md','TODO.md','gate.mjs',
  'module/generate-manifest.mjs','ci/run-suite.mjs','tests/helpers.mjs',
  'tests/backend/task.test.mjs','tests/backend/indexing.test.mjs',
  ...['backend','ui','api-mcp','widgets','package','docs'].flatMap(name=>
    [`ci/${name}.mjs`,`tests/${name}/contract.test.mjs`])];
m.packaging.validationBinding={moduleId:id,moduleVersion:version,sourceRevision:revision};
m.lifecycle.absent={files:{reason:'The connection probe stores no R2 file.',policyRule:'meili.no-files'}};
m.lifecycle.configuration='explicit-state';
writeFileSync(new URL('module/models.json',root),JSON.stringify(models,null,2)+'\n');
writeFileSync(new URL('module/manifest.json',root),JSON.stringify(m,null,2)+'\n');
