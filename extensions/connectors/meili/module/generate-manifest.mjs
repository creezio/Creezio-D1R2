import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {meiliConnectorDescriptor} from './storage.ts';

const root=new URL('../',import.meta.url);
const template=JSON.parse(readFileSync(new URL('module/manifest.json',root),'utf8'));
const id='creezio.meili',connectorId='meili.api.v1',version='0.1.0',revision='t28-meili-connection-v1';
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
  field('revision','integer',{constraints:{minimum:1}}),field('updated_at','date-time')],['manage','read']),
  model('connector_secret','Secret Meili scellé',[field('id','string',{protected:true,constraints:{minLength:1,maxLength:128}}),
    field('binding_id','string',{protected:true,constraints:{minLength:1,maxLength:128}}),
    field('ciphertext','string',{protected:true,constraints:{minLength:1,maxLength:32768}}),
    field('key_id','string',{protected:true,constraints:{minLength:1,maxLength:128}}),
    field('version','integer',{protected:true,constraints:{minimum:1}}),
    field('state','string',{protected:true,constraints:{enum:['active','revoked']}})],['manage','read'])];
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
  actions:['read','execute'],enforcement:{request:true,commit:true},public:false}];
const errors=['invalid_input','unauthorized','forbidden','not_found','conflict','rate_limited','unsupported','unavailable','unknown']
  .map(code=>({code,retryable:['rate_limited','unavailable','unknown'].includes(code),
    outcome:code==='unknown'?'unknown':'rejected'}));
const operations=[];
function operation(name,title,kind,input,output,permission,reads,writes,options={}){
  const command=kind==='command';
  operations.push({id:name,title,kind,input,output,permissions:[ref('permission',permission)],
    audiences:['admin'],actors:['user','delegated-user','machine'],
    context:'required',handler:{path:'module/operations.ts',export:options.exportName},
    effects:{reads:reads.map(name=>ref('model',name)),writes:writes.map(name=>ref('model',name)),
      emits:[],calls:[],providers:options.remote?[connectorId]:[]},errors,
    pagination:options.pagination??{mode:'none'},
    idempotency:command?{mode:'required',keyField:'requestKey',scope:'actor-context-operation',retentionSeconds:86400}:{mode:'none'},
    approval:{mode:'none'},concurrency:options.cas?{mode:'object-version',versionField:'revision'}:{mode:'none'},
    execution:{maxDurationMs:10000,maxItems:options.maxItems??4,resumable:false},
    audit:{required:true,redactFields:['apiKey']},public:false});
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
    idempotent:op.kind==='query',openWorld:op.effects.providers.length>0},textFallback:true}));
const m=structuredClone(template);
m.identity={id,title:'Connecteur Meili externe',publisher:'creezio',origin:'https://github.com/creezio/Creezio-D1R2',
  version,source:{kind:'snapshot',revision,integrity:`sha256-${createHash('sha256').update(revision).digest('hex')}`},
  license:{expression:'NOASSERTION',file:'LICENSE'}};
m.compatibility={core:'^0.0.0',sdk:'^1.4.0',requiredCapabilities:['runtime.worker','data.d1.shared'],optionalCapabilities:[]};
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
  search:[],permissions,operations,api,mcp:{tools:mcpTools,resources:[],prompts:[],skills:[]},
  ui:{views:[{id:'admin',title:'Recherche Meili',surfaces:['workspace'],route:'/admin/meili',
    component:{path:'ui/index.tsx',export:'MeiliAdminView'},permissions:[ref('permission','manage')],
    operations:operations.map(op=>ref('operation',op.id)),input:viewInput,
    panel:{identityFields:[],navigation:'sdk',retention:'preserve',inactiveEffects:'suspend',stateSchema:panelState}}],
    navigation:[{id:'meili-admin',title:'Recherche Meili',view:ref('view','admin'),permissions:[ref('permission','manage')],
      surfaces:['workspace'],order:78}],slots:[],front:{mode:'absent',justification:{reason:'Meili settings belong to the administrative workspace; no public search is implemented.',
      policyRule:'meili.workspace-only'}},themes:[],styles:[]},widgets:[],publicContracts:[]};
m.documentation.versionBinding={moduleVersion:version,sourceRevision:revision};
for(const suite of ['backend','ui','api-mcp','widgets','package','docs'])m.validation.suites[suite].tests=[`tests/${suite}/contract.test.mjs`];
m.validation.suites.widgets.mode='not-applicable';m.validation.suites.widgets.justification={
  reason:'This tranche verifies a connection only and exposes no searchable data or result widget.',
  policyRule:'meili.widgets-pending-qualification'};
m.packaging.runtime.files=['module/manifest.json','module/models.json','module/entry.server.ts','module/storage.ts',
  'module/operations.ts','module/service.ts','ui/index.tsx','ui/panel-state.ts','README.md','prd.md','CHANGELOG.md',
  'LICENSE','plugin/plugin.json','plugin/mcp.json','plugin/contributions.ts'];
m.packaging.validation.files=['AGENTS.md','FILES.md','interview.md','TODO.md','gate.mjs',
  'module/generate-manifest.mjs','ci/run-suite.mjs','tests/helpers.mjs',
  ...['backend','ui','api-mcp','widgets','package','docs'].flatMap(name=>
    [`ci/${name}.mjs`,`tests/${name}/contract.test.mjs`])];
m.packaging.validationBinding={moduleId:id,moduleVersion:version,sourceRevision:revision};
m.lifecycle.absent={files:{reason:'The connection probe stores no R2 file.',policyRule:'meili.no-files'},
  widgets:{reason:'The connection probe has no search result to display in a widget.',policyRule:'meili.widgets-pending-qualification'}};
m.lifecycle.configuration='explicit-state';
writeFileSync(new URL('module/models.json',root),JSON.stringify(models,null,2)+'\n');
writeFileSync(new URL('module/manifest.json',root),JSON.stringify(m,null,2)+'\n');
