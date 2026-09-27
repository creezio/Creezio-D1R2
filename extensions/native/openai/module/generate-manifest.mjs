import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

const root=new URL('../',import.meta.url);
const template=JSON.parse(readFileSync(new URL('../conversations/module/manifest.json',root),'utf8'));
const id='creezio.openai', providerId='openai.responses.v1';
const ref=(kind,name)=>({moduleId:id,kind,id:name});
const field=(name,type,options={})=>({id:name,type,nullable:options.nullable??false,
  protected:options.protected??false,computed:false,...(options.constraints?{constraints:options.constraints}:{})});
const str=(max=128,min=1)=>({type:'string',minLength:min,maxLength:max});
const int=(min=0,max=Number.MAX_SAFE_INTEGER)=>({type:'integer',minimum:min,maximum:max});
const range=(min=0)=>({minimum:min,maximum:Number.MAX_SAFE_INTEGER});
const obj=(properties,required=Object.keys(properties))=>({type:'object',properties,required,additionalProperties:false});
const nullable=value=>({anyOf:[value,{type:'null'}]});
const model=(name,title,fields)=>({id:name,title,scope:'context',contextField:'context_id',
  fields:[field('context_id','string',{protected:true,constraints:{minLength:1,maxLength:128}}),...fields],
  primaryKey:['context_id','id'],indexes:[],relations:[],permissions:[ref('permission','use'),ref('permission','manage')],
  deletion:{mode:'soft',requiresApproval:false},public:false});
const models=[
  model('provider_config','Configuration fournisseur OpenAI',[
    field('id','string',{constraints:{minLength:1,maxLength:128}}),
    field('model_id','string',{constraints:{minLength:1,maxLength:128}}),
    field('api_key_ref','string',{nullable:true,constraints:{minLength:1,maxLength:128}}),
    field('secret_version','integer',{nullable:true,constraints:range(1)}),
    field('enabled','boolean'),field('revision','integer',{constraints:range(1)}),field('updated_at','date-time')]),
  model('provider_secret','Secret fournisseur protégé',[
    field('id','string',{protected:true,constraints:{minLength:1,maxLength:128}}),
    field('binding_id','string',{protected:true,constraints:{minLength:1,maxLength:128}}),
    field('ciphertext','string',{protected:true,constraints:{minLength:1,maxLength:32768}}),
    field('key_id','string',{protected:true,constraints:{minLength:1,maxLength:128}}),
    field('version','integer',{protected:true,constraints:range(1)}),
    field('state','string',{protected:true,constraints:{enum:['active','revoked']}})])
];
const schemaList=[];
const schema=(name,value)=>{schemaList.push({id:name,schema:value});return {schemaId:name};};
const configView=obj({providerId:{type:'string',const:providerId},enabled:{type:'boolean'},
  modelId:nullable(str()),state:{type:'string',enum:['ready','missing','invalid','unavailable','unverified']},revision:int(0)});
const configOutput=schema('config-output',obj({config:configView}));
const empty=schema('empty-input',obj({}));
const listInput=schema('models-list-input',obj({limit:int(1,50),cursor:str(128)},['limit']));
const listOutput=schema('models-list-output',obj({items:{type:'array',items:obj({id:str()}),maxItems:50},
  nextCursor:nullable(str(128))}));
const configInput=schema('config-set-input',obj({requestKey:str(),modelId:str(),enabled:{type:'boolean'},revision:int(0)}));
const keyInput=schema('config-key-set-input',obj({requestKey:str(),apiKey:str(4096,8),
  modelId:str(),enabled:{type:'boolean'},revision:int(0)}));
const secretSetting=schema('api-key-reference-setting',str(128));
const modelSetting=schema('model-id-setting',str());
const use={id:'use',title:'Utiliser le fournisseur OpenAI',audiences:['admin','app'],actors:['user','delegated-user'],
  scopes:['openai.use'],context:'required',default:'deny',resources:models.map(m=>ref('model',m.id)),
  actions:['read','execute'],enforcement:{request:true,commit:true},public:false};
const manage={id:'manage',title:'Configurer le fournisseur OpenAI',audiences:['admin'],actors:['user'],
  scopes:['openai.manage'],context:'required',default:'deny',resources:models.map(m=>ref('model',m.id)),
  actions:['read','create','update','execute'],enforcement:{request:true,commit:true},public:false};
const errors=['invalid_input','unauthorized','forbidden','not_found','conflict','rate_limited','unavailable','unknown']
  .map(code=>({code,retryable:['rate_limited','unavailable','unknown'].includes(code),outcome:code==='unknown'?'unknown':'rejected'}));
function operation(name,title,kind,inp,out,permission,reads,writes,options={}){
  const command=kind==='command';
  return {id:name,title,kind,input:inp,output:out,permissions:[ref('permission',permission)],
    audiences:permission==='manage'?['admin']:['admin','app'],actors:permission==='manage'?['user']:['user','delegated-user'],
    context:'required',handler:{path:'module/operations.ts',export:options.exportName},
    effects:{reads:reads.map(x=>ref('model',x)),writes:writes.map(x=>ref('model',x)),emits:[],calls:[],providers:[]},
    errors,pagination:options.pagination??{mode:'none'},
    idempotency:command?{mode:'required',keyField:'requestKey',scope:'actor-context-operation',retentionSeconds:86400}:{mode:'none'},
    approval:{mode:'none'},concurrency:options.concurrency??{mode:'none'},
    execution:{maxDurationMs:10000,maxItems:options.maxItems??100,resumable:false},
    audit:{required:true,redactFields:['apiKey']},public:false};
}
const operations=[
  operation('config.read','Lire la configuration OpenAI','query',empty,configOutput,'use',['provider_config'],[],{exportName:'configRead'}),
  operation('models.list','Lister les modèles disponibles','query',listInput,listOutput,'use',['provider_config'],[],
    {exportName:'modelsList',maxItems:50,pagination:{mode:'cursor',cursorField:'cursor',limitField:'limit',maxItems:50}}),
  operation('config.set','Configurer le modèle OpenAI','command',configInput,configOutput,'manage',['provider_config'],['provider_config'],
    {exportName:'configSet'}),
  operation('config.key.set','Configurer la clé OpenAI','command',keyInput,configOutput,'manage',
    ['provider_config','provider_secret'],['provider_config','provider_secret'],
    {exportName:'configKeySet'})
];
for(const op of operations)if(['config.read','models.list','config.set'].includes(op.id))
  op.effects.providers.push('openai.responses.v1');
const api=[];
for(const audience of ['admin','app'])for(const op of operations){
  if(!op.audiences.includes(audience))continue;
  const command=op.kind==='command',parameters=[];
  if(op.id==='models.list')for(const [name,required] of [['limit',true],['cursor',false]])
    parameters.push({name,in:'query',inputField:name,required});
  api.push({id:`${audience}.${op.id}`,method:command?'POST':'GET',
    path:`/api/${audience}/openai/${op.id.replaceAll('.','/')}`,operation:ref('operation',op.id),audience,
    auth:op.audiences.length===1?['session']:['session','oauth'],parameters,input:op.input,output:op.output,
    rateLimit:{requests:30,windowSeconds:60}});
}
const m=structuredClone(template),revision='t15-openai-v1';
m.identity={id,title:'OpenAI pour Conversations',publisher:'creezio',origin:'https://github.com/creezio/Creezio-D1R2',
  version:'0.0.0',source:{kind:'snapshot',revision,integrity:`sha256-${createHash('sha256').update(revision).digest('hex')}`},
  license:{expression:'NOASSERTION',file:'LICENSE'}};
m.compatibility={core:'^0.0.0',sdk:'^1.0.0',requiredCapabilities:['runtime.worker','data.d1.shared'],optionalCapabilities:[]};
m.entrypoints={server:{path:'module/entry.server.ts',export:'openai'},ui:{path:'ui/index.tsx',export:'OpenAIAdminView'},
  plugin:{manifest:'plugin/plugin.json',mcp:'plugin/mcp.json',contributions:{path:'plugin/contributions.ts',export:'contributions'}}};
m.dependencies=[{moduleId:'creezio.conversations',origin:m.identity.origin,versionRange:'^0.0.0',optional:false,
  contracts:[],whenAbsent:'block',whenIncompatible:'block',autoInstall:false}];
m.contracts={schemas:schemaList,models,files:[],events:[],
  settings:[{id:'api-key-ref',title:'Référence de la clé OpenAI',schema:secretSetting,visibility:'secret-reference',
    required:true,permissions:[ref('permission','manage')],provider:providerId,redact:true},
    {id:'model-id',title:'Modèle OpenAI',schema:modelSetting,visibility:'server',required:true,
      permissions:[ref('permission','manage')],provider:providerId,redact:true}],
  search:[],permissions:[use,manage],operations,api,mcp:{tools:[],resources:[],prompts:[],skills:[]},
  ui:{views:[{id:'admin',title:'OpenAI',surfaces:['workspace'],route:'/admin/openai',
    component:{path:'ui/index.tsx',export:'OpenAIAdminView'},permissions:[ref('permission','manage')],
    operations:operations.map(op=>ref('operation',op.id)),input:empty,
    panel:{identityFields:[],navigation:'sdk',retention:'preserve',inactiveEffects:'suspend'}}],
    navigation:[{id:'openai-admin',title:'OpenAI',view:ref('view','admin'),permissions:[ref('permission','manage')],
      surfaces:['workspace'],order:25}],slots:[],front:{mode:'absent',justification:{reason:'Configuration is admin-only; chat uses Conversations.',
      policyRule:'openai.admin-only'}},themes:[],styles:[]},widgets:[],publicContracts:[]};
m.documentation.versionBinding={moduleVersion:'0.0.0',sourceRevision:revision};
for(const name of ['backend','ui','api-mcp','widgets','package','docs'])
  m.validation.suites[name].tests=[`tests/${name}/contract.test.mjs`];
m.validation.suites.widgets.mode='not-applicable';
m.validation.suites.widgets.justification={reason:'Widgets follow in T16.',policyRule:'openai.widgets-t16'};
m.packaging.runtime.files=['module/manifest.json','module/models.json','module/entry.server.ts','module/operations.ts',
  'module/service.ts','module/storage.ts','module/transport.ts','ui/index.tsx','ui/config-panel.tsx',
  'README.md','prd.md','CHANGELOG.md','LICENSE','plugin/plugin.json','plugin/mcp.json','plugin/contributions.ts'];
m.packaging.validation.files=['AGENTS.md','FILES.md','interview.md','TODO.md','gate.mjs','module/generate-manifest.mjs',
  'ci/run-suite.mjs','tests/helpers.mjs',...['backend','ui','api-mcp','widgets','package','docs'].flatMap(name=>
    [`ci/${name}.mjs`,`tests/${name}/contract.test.mjs`])];
m.packaging.validationBinding={moduleId:id,moduleVersion:'0.0.0',sourceRevision:revision};
m.lifecycle.absent={widgets:{reason:'Widgets follow in T16.',policyRule:'openai.widgets-t16'},
  files:{reason:'Provider configuration contains no user file category.',policyRule:'openai.no-files'}};
m.lifecycle.configuration='explicit-state';
writeFileSync(new URL('module/models.json',root),JSON.stringify(models,null,2)+'\n');
writeFileSync(new URL('module/manifest.json',root),JSON.stringify(m,null,2)+'\n');
