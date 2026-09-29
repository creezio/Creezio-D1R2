import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

const root=new URL('../',import.meta.url);
const template=JSON.parse(readFileSync(new URL('../openai/module/manifest.json',root),'utf8'));
const id='creezio.crm', revision='t20-crm-widgets-v2';
const ref=(kind,name)=>({moduleId:id,kind,id:name});
const field=(name,type,options={})=>({id:name,type,nullable:options.nullable??false,
  protected:options.protected??false,computed:false,...(options.constraints?{constraints:options.constraints}:{})});
const S=(max=128,min=1)=>({minLength:min,maxLength:max});
const I=(min=0)=>({minimum:min,maximum:Number.MAX_SAFE_INTEGER});
const common=[field('context_id','string',{protected:true,constraints:S()}),
  field('id','string',{constraints:S()}),field('name','string',{constraints:S(240)}),
  field('notes','string',{nullable:true,constraints:S(4000,0)}),
  field('city','string',{nullable:true,constraints:S(240,0)}),
  field('created_at','date-time'),field('updated_at','date-time'),
  field('archived_at','date-time',{nullable:true}),field('revision','integer',{constraints:I(1)})];
const relation=(name,source,target)=>({id:name,fields:['context_id',source],
  target:ref('model',target),targetFields:['context_id','id'],onDelete:'restrict'});
const model=(name,title,fields,relations=[])=>({id:name,title,scope:'context',contextField:'context_id',
  fields:[...common,...fields],primaryKey:['context_id','id'],
  indexes:[{id:'recent',fields:['context_id','updated_at','id'],unique:false}],
  relations,permissions:[ref('permission','use')],deletion:{mode:'soft',requiresApproval:false},public:false});
const models=[model('company','Entreprises',[
  field('website','string',{nullable:true,constraints:S(512,0)})]),
  model('contact','Contacts',[
    field('email','string',{nullable:true,constraints:S(320,0)}),
    field('phone','string',{nullable:true,constraints:S(240,0)}),
    field('company_id','string',{nullable:true,constraints:S()})],
  [relation('company','company_id','company')]),
  model('prospect','Prospects',[
    field('contact_name','string',{nullable:true,constraints:S(240,0)}),
    field('email','string',{nullable:true,constraints:S(320,0)}),
    field('phone','string',{nullable:true,constraints:S(240,0)}),
    field('website','string',{nullable:true,constraints:S(512,0)}),
    field('stage','string',{constraints:{enum:['a_contacter','contacte','rdv','client','perdu']}}),
    field('position','integer',{constraints:I(0)}),
    field('company_id','string',{nullable:true,constraints:S()}),
    field('contact_id','string',{nullable:true,constraints:S()})],
  [relation('company','company_id','company'),relation('contact','contact_id','contact')])];
const obj=(properties,required=Object.keys(properties))=>({type:'object',properties,required,additionalProperties:false});
const str=(max=128,min=1)=>({type:'string',minLength:min,maxLength:max});
const integer=(min=0,max=Number.MAX_SAFE_INTEGER)=>({type:'integer',minimum:min,maximum:max});
const nullable=value=>({anyOf:[value,{type:'null'}]});
const schemas=[];
const schema=(name,value)=>{schemas.push({id:name,schema:value});return {schemaId:name};};
const commonView={id:str(),name:str(240),notes:nullable(str(4000,0)),city:nullable(str(240,0)),
  createdAt:str(35),updatedAt:str(35),archivedAt:nullable(str(35)),revision:integer(1)};
const extras={company:{website:nullable(str(512,0))},
  contact:{email:nullable(str(320,0)),phone:nullable(str(240,0)),companyId:nullable(str())},
  prospect:{contactName:nullable(str(240,0)),email:nullable(str(320,0)),phone:nullable(str(240,0)),
    website:nullable(str(512,0)),stage:{type:'string',enum:['a_contacter','contacte','rdv','client','perdu']},
    position:integer(),companyId:nullable(str()),contactId:nullable(str())}};
const mutable={company:{name:str(240),city:nullable(str(240,0)),website:nullable(str(512,0)),notes:nullable(str(4000,0))},
  contact:{name:str(240),city:nullable(str(240,0)),email:nullable(str(320,0)),phone:nullable(str(240,0)),
    notes:nullable(str(4000,0)),companyId:nullable(str())},
  prospect:{name:str(240),city:nullable(str(240,0)),contactName:nullable(str(240,0)),
    email:nullable(str(320,0)),phone:nullable(str(240,0)),website:nullable(str(512,0)),notes:nullable(str(4000,0)),
    stage:{type:'string',enum:['a_contacter','contacte','rdv','client','perdu']},position:integer(),
    companyId:nullable(str()),contactId:nullable(str())}};
const operations=[];
const entities=['company','contact','prospect'];
const errors=['invalid_input','unauthorized','forbidden','not_found','conflict','rate_limited','unavailable','unknown']
  .map(code=>({code,retryable:['rate_limited','unavailable','unknown'].includes(code),outcome:code==='unknown'?'unknown':'rejected'}));
const permission={id:'use',title:'Gérer les relations CRM',audiences:['admin','app'],actors:['user','delegated-user','machine'],
  scopes:['crm.use'],context:'required',default:'deny',resources:models.map(m=>ref('model',m.id)),
  actions:['read','create','update','execute'],enforcement:{request:true,commit:true},public:false};
function operation(entity,action,input,output){
  const command=!['read','list','search'].includes(action);
  const reads=action==='create'?[]:[entity],writes=command?[entity]:[];
  if(command&&action!=='archive'&&entity==='prospect'){
    reads.push('company','contact');writes.push('company','contact');
  }else if(command&&action!=='archive'&&entity==='contact'){
    reads.push('company');writes.push('company');
  }
  if(action==='archive'&&entity==='company')reads.push('contact','prospect');
  if(action==='archive'&&entity==='contact')reads.push('prospect');
  if(action==='update'&&entity==='contact')reads.push('prospect');
  const name=`${entity}.${action}`;
  operations.push({id:name,title:`${action} ${entity}`,kind:command?'command':'query',input,output,
    permissions:[ref('permission','use')],audiences:['admin','app'],actors:['user','delegated-user','machine'],
    context:'required',handler:{path:'module/operations.ts',export:entity+action[0].toUpperCase()+action.slice(1)},
    effects:{reads:[...new Set(reads)].map(m=>ref('model',m)),writes:writes.map(m=>ref('model',m)),
      emits:[],calls:[],providers:[]},errors,
    pagination:['list','search'].includes(action)?{mode:'cursor',cursorField:'cursor',limitField:'limit',maxItems:25}:{mode:'none'},
    idempotency:command?{mode:'required',keyField:'requestKey',scope:'actor-context-operation',retentionSeconds:86400}:{mode:'none'},
    // Child writes may CAS their own revision and one or two parent revisions.
    // The operation engine's object-version mode requires every patch to match the
    // single input revision, so the module supplies its own guarded comparisons.
    approval:{mode:'none'},concurrency:{mode:'none'},
    execution:{maxDurationMs:10000,maxItems:['list','search'].includes(action)?500:25,resumable:false},
    audit:{required:true,redactFields:['notes','email','phone','query']},public:false});
}
for(const entity of entities){
  const view=obj({...commonView,...extras[entity]});
  const output=schema(`${entity}-output`,obj({item:view}));
  const page=schema(`${entity}-page`,obj({items:{type:'array',items:view,maxItems:25},nextCursor:nullable(str(2048))}));
  const idInput=schema(`${entity}-id`,obj({id:str()}));
  const listInput=schema(`${entity}-list`,obj({limit:integer(1,25),cursor:str(2048),archived:{type:'boolean'}},['limit']));
  const searchInput=schema(`${entity}-search`,obj({limit:integer(1,25),query:str(120),cursor:str(2048),archived:{type:'boolean'}},['limit','query']));
  const createInput=schema(`${entity}-create`,obj({requestKey:str(),...mutable[entity]},['requestKey','name']));
  const updateInput=schema(`${entity}-update`,obj({requestKey:str(),id:str(),revision:integer(1),...mutable[entity]},
    ['requestKey','id','revision']));
  const stateInput=schema(`${entity}-state`,obj({requestKey:str(),id:str(),revision:integer(1)}));
  operation(entity,'create',createInput,output);
  operation(entity,'read',idInput,output);
  operation(entity,'list',listInput,page);
  operation(entity,'search',searchInput,page);
  operation(entity,'update',updateInput,output);
  operation(entity,'archive',stateInput,output);
  operation(entity,'restore',stateInput,output);
}
const api=[],tools=[];
for(const op of operations){
  const command=op.kind==='command';
  for(const audience of ['admin','app']){
    const properties=schemas.find(s=>s.id===op.input.schemaId).schema;
    const parameters=command?[]:Object.entries(properties.properties).map(([name])=>({name,in:'query',inputField:name,
      required:properties.required.includes(name)}));
    api.push({id:`${audience}.${op.id}`,method:command?'POST':'GET',path:`/api/${audience}/crm/${op.id.replaceAll('.','/')}`,
      operation:ref('operation',op.id),audience,auth:['session','oauth','api-token'],parameters,input:op.input,output:op.output,
      rateLimit:{requests:60,windowSeconds:60}});
  }
  const [entity,action]=op.id.split('.');
  const widget=['list','search'].includes(action)?ref('widget',`${entity}-list`):
    action==='read'?ref('widget',`${entity}-detail`):null;
  tools.push({id:op.id,name:`crm_${op.id.replaceAll('.','_')}`,operation:ref('operation',op.id),
    audiences:['admin','app'],auth:['oauth','api-token'],input:op.input,output:op.output,
    annotations:{readOnly:!command,destructive:op.id.endsWith('.archive'),idempotent:!command,openWorld:false},
    ...(widget?{widget}:{}),textFallback:true});
}
const widgetState=schema('crm-widget-state',obj({id:str(),query:str(120,0),cursor:str(2048),
  archived:{type:'boolean'}},[]));
const widgetResource=name=>({id:`${name}-ui`,uri:`ui://${id}/${name}`,
  mimeType:'text/html;profile=mcp-app',audiences:['admin','app'],permissions:[ref('permission','use')],
  source:{kind:'asset',path:`ui/widgets/${name}.html`},widget:ref('widget',name),
  ui:{csp:{connectDomains:[],resourceDomains:[],frameDomains:[],baseUriDomains:[]},
    permissions:{},prefersBorder:true}});
const widgetAction=(id,label,input,operation)=>({id,label,input,
  requiredCapabilities:[],fallback:'unavailable',mode:'direct',
  target:{kind:'operation',operation:ref('operation',operation)}});
const widget=(entity,kind)=>{
  const name=`${entity}-${kind}`,list=kind==='list';
  const output={schemaId:list?`${entity}-page`:`${entity}-output`};
  return {id:name,version:'1.0.0',compatibility:'^1.0.0',resource:`${name}-ui`,
    renderer:{path:`ui/widgets/${name}.ts`,export:`start${entity[0].toUpperCase()+entity.slice(1)}${list?'List':'Detail'}`},
    input:output,state:widgetState,result:output,audiences:['admin','app'],
    permissions:[ref('permission','use')],requiredCapabilities:[],assets:[],
    actions:list?[widgetAction('list','Lister',{schemaId:`${entity}-list`},`${entity}.list`),
      widgetAction('search','Rechercher',{schemaId:`${entity}-search`},`${entity}.search`)]:
      [widgetAction('read','Actualiser',{schemaId:`${entity}-id`},`${entity}.read`)],
    instance:{identity:'host-generated',revision:'monotonic',correlation:'request-instance-conversation',
      objectVersion:'distinct',lateResponse:'reject-stale'},
    // MCP envelopes can contain structured output plus re-escaped JSON text.
    transport:{protocol:'mcp-apps',maxPayloadBytes:786432,timeoutMs:15000,
      uncertainResult:'reconcile-before-retry',fallbackDispatch:'before-first-dispatch-only'}};
};
const widgetNames=entities.flatMap(entity=>[`${entity}-list`,`${entity}-detail`]);
const skillPath='plugin/skills/crm.md';
const skillIntegrity=`sha256-${createHash('sha256').update(readFileSync(new URL(skillPath,root))).digest('hex')}`;
const m=structuredClone(template);
m.identity={id,title:'CRM natif',publisher:'creezio',origin:'https://github.com/creezio/Creezio-D1R2',
  version:'0.0.0',source:{kind:'snapshot',revision,integrity:`sha256-${createHash('sha256').update(revision).digest('hex')}`},
  license:{expression:'NOASSERTION',file:'LICENSE'}};
m.compatibility={core:'^0.0.0',sdk:'^1.0.0',requiredCapabilities:['runtime.worker','data.d1.shared'],optionalCapabilities:[]};
m.entrypoints={server:{path:'module/entry.server.ts',export:'crm'},ui:{path:'ui/index.tsx',export:'CrmWorkspaceView'},
  plugin:{manifest:'plugin/plugin.json',mcp:'plugin/mcp.json',contributions:{path:'plugin/contributions.ts',export:'contributions'}}};
m.dependencies=[{moduleId:'creezio.access',origin:m.identity.origin,versionRange:'^0.0.0',optional:false,
  contracts:[],whenAbsent:'block',whenIncompatible:'block',autoInstall:false}];
const viewInput=schema('crm-view-input',obj({entity:{type:'string',enum:['company','contact','prospect']}},[]));
const panelState=schema('crm-panel-state',obj({entity:{type:'string',enum:['company','contact','prospect']},query:str(120,0),archived:{type:'boolean'},
  pending:obj({entity:{type:'string',enum:['company','contact','prospect']},
    action:{type:'string',enum:['create','update','archive','restore']},requestKey:str(128),
    sessionId:str(128),contextId:str(128),audience:{type:'string',enum:['admin','app']}})},[]));
m.contracts={schemas,models,files:[],events:[],settings:[],search:[],permissions:[permission],operations,api,
  mcp:{tools,resources:widgetNames.map(widgetResource),prompts:[],
    skills:[{id:'crm',path:skillPath,audiences:['admin','app'],
      operations:entities.flatMap(entity=>['list','search','read'].map(action=>ref('operation',`${entity}.${action}`))),
      resources:widgetNames.map(name=>`${name}-ui`),integrity:skillIntegrity}]},
  ui:{views:[{id:'workspace',title:'CRM',surfaces:['workspace'],
    route:'/admin/crm',component:{path:'ui/index.tsx',export:'CrmWorkspaceView'},permissions:[ref('permission','use')],
    operations:operations.map(op=>ref('operation',op.id)),input:viewInput,
    panel:{identityFields:[],navigation:'sdk',retention:'preserve',inactiveEffects:'suspend',stateSchema:panelState}},
    {id:'front',title:'CRM',surfaces:['front'],route:'/crm',component:{path:'ui/index.tsx',export:'CrmWorkspaceView'},
    permissions:[ref('permission','use')],operations:operations.map(op=>ref('operation',op.id)),input:viewInput,
    panel:{identityFields:[],navigation:'sdk',retention:'preserve',inactiveEffects:'suspend',stateSchema:panelState}}],
    navigation:[{id:'crm',title:'CRM',view:ref('view','workspace'),permissions:[ref('permission','use')],
      surfaces:['workspace'],order:55},{id:'crm-front',title:'CRM',view:ref('view','front'),
      permissions:[ref('permission','use')],surfaces:['front'],order:55}],slots:[],front:{mode:'provided'},
      themes:[],styles:[]},widgets:entities.flatMap(entity=>[widget(entity,'list'),widget(entity,'detail')]),
      publicContracts:[]};
m.documentation.versionBinding={moduleVersion:'0.0.0',sourceRevision:revision};
for(const name of ['backend','ui','api-mcp','widgets','package','docs'])m.validation.suites[name].tests=[`tests/${name}/contract.test.mjs`];
m.validation.suites.widgets.tests.push('tests/widgets/runtime.test.mjs');
m.validation.suites.widgets.mode='required';delete m.validation.suites.widgets.justification;
m.packaging.runtime.files=['module/manifest.json','module/models.json','module/entry.server.ts','module/operations.ts',
  'module/service.ts','ui/index.tsx','ui/editing.ts','ui/commands.ts','ui/kanban.tsx','README.md','prd.md','CHANGELOG.md','LICENSE',
  'ui/widgets/runtime.ts',...widgetNames.flatMap(name=>[`ui/widgets/${name}.ts`,`ui/widgets/${name}.html`]),
  'plugin/plugin.json','plugin/mcp.json','plugin/contributions.ts',skillPath];
m.packaging.validation.files=['AGENTS.md','FILES.md','interview.md','TODO.md','gate.mjs','module/generate-manifest.mjs',
  'ci/run-suite.mjs','tests/helpers.mjs',...['backend','ui','api-mcp','widgets','package','docs'].flatMap(name=>
    [`ci/${name}.mjs`,`tests/${name}/contract.test.mjs`]),'tests/widgets/runtime.test.mjs'];
m.packaging.validationBinding={moduleId:id,moduleVersion:'0.0.0',sourceRevision:revision};
m.lifecycle.absent={files:{reason:'CRM v1 has no file category.',policyRule:'crm.no-files'}};
m.lifecycle.configuration='explicit-state';
writeFileSync(new URL('module/models.json',root),JSON.stringify(models,null,2)+'\n');
writeFileSync(new URL('module/manifest.json',root),JSON.stringify(m,null,2)+'\n');
