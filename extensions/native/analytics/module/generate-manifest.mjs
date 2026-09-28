import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

const root=new URL('../',import.meta.url);
const template=JSON.parse(readFileSync(new URL('module/manifest.json',root),'utf8'));
const id='creezio.analytics',ref=(kind,name)=>({moduleId:id,kind,id:name});
const field=(id,type,options={})=>({id,type,nullable:options.nullable??false,
  protected:options.protected??false,computed:false,...(options.constraints?{constraints:options.constraints}:{})});
const string=(max=128,min=1)=>({minLength:min,maxLength:max});
const model={id:'event',title:'Événement déclaré',scope:'context',contextField:'context_id',fields:[
  field('context_id','string',{protected:true,constraints:string()}),
  field('id','string',{constraints:string(36)}),
  field('principal_id','string',{constraints:string()}),
  field('actor_principal_id','string',{constraints:string()}),
  field('event_type','string',{constraints:{enum:['page_view','click','activity','error']}}),
  field('action_id','string',{nullable:true,constraints:string(80)}),
  field('surface','string',{constraints:string(64)}),
  field('path','string',{nullable:true,constraints:string(256)}),
  field('error_code','string',{nullable:true,constraints:string(80)}),
  field('duration_ms','integer',{nullable:true,constraints:{minimum:0,maximum:86_400_000}}),
  field('created_at','date-time')],primaryKey:['context_id','id'],
  indexes:[{id:'by-time',fields:['context_id','created_at','id'],unique:false}],relations:[],
  permissions:[ref('permission','emit'),ref('permission','read')],
  deletion:{mode:'soft',requiresApproval:false},public:false};
const obj=(properties,required=Object.keys(properties))=>({type:'object',properties,required,additionalProperties:false});
const str=(max=128,min=1)=>({type:'string',minLength:min,maxLength:max});
const int=(min=0,max=Number.MAX_SAFE_INTEGER)=>({type:'integer',minimum:min,maximum:max});
const nullable=value=>({anyOf:[value,{type:'null'}]});
const schemas=[],schema=(id,schema)=>{schemas.push({id,schema});return {schemaId:id};};
const period={type:'string',enum:['day','week','month','year']};
const eventType={type:'string',enum:['page_view','click','activity','error']};
const event=obj({id:str(36),principalId:str(),actorPrincipalId:str(),type:eventType,
  actionId:nullable(str(80)),surface:str(64),path:nullable(str(256)),errorCode:nullable(str(80)),
  reportedDurationMs:nullable(int(0,86_400_000)),occurredAt:str(35),source:{const:'reported'}});
const bounds=obj({period,from:str(35),to:str(35)});
const count=obj({name:str(256),count:int()});
const counts=(max)=>({type:'array',items:count,maxItems:max});
const recordInput=schema('event-record-input',obj({requestKey:str(),type:eventType,surface:str(64),actionId:str(80),
  path:str(256),errorCode:str(80),reportedDurationMs:int(0,86_400_000)},['requestKey','type','surface']));
const recordOutput=schema('event-record-output',obj({event}));
const listInput=schema('event-list-input',obj({period,limit:int(1,50),cursor:str(2048),query:str(120,0),
  type:eventType,principalId:str()},['period','limit']));
const listOutput=schema('event-list-output',obj({period:bounds,items:{type:'array',items:event,maxItems:50},
  nextCursor:nullable(str(2048)),complete:{type:'boolean'},scanned:int(0,500)}));
const snapshotInput=schema('analytics-snapshot-input',obj({period,cursor:str(2048),
  principalId:str()},['period']));
const snapshotOutput=schema('analytics-snapshot-output',obj({period:bounds,source:{const:'reported'},
  complete:{type:'boolean'},scanned:int(0,500),nextCursor:nullable(str(2048)),
  totals:obj({events:int(),pageViews:int(),clicks:int(),errors:int(),reportedDurationMs:int()}),
  activePrincipals:int(),timeline:counts(366),hours:counts(24),pages:counts(20),clicks:counts(20),users:counts(20)}));
const exportInput=schema('event-export-input',obj({...schemas.find(s=>s.id==='event-list-input').schema.properties,
  format:{type:'string',enum:['json','csv']}},['period','limit','format']));
const exportOutput=schema('event-export-output',obj({format:{type:'string',enum:['json','csv']},
  content:str(180000,0),nextCursor:nullable(str(2048)),complete:{type:'boolean'},period:bounds}));
const viewInput=schema('analytics-view-input',obj({}));
const panelState=schema('analytics-panel-state',obj({sessionId:str(128),
  audience:{type:'string',enum:['admin','app']},contextId:str(128),
  period,query:str(120,0),type:str(16,0),principalId:str(128,0)},
['sessionId','audience','contextId','period','query','type','principalId']));
const permissions=[
  {id:'emit',title:'Déclarer un événement analytique',audiences:['admin','app'],
    actors:['user','delegated-user','machine'],scopes:['analytics.emit'],context:'required',default:'deny',
    resources:[ref('model','event')],actions:['create','execute'],
    enforcement:{request:true,commit:true},public:false},
  {id:'read',title:'Lire les événements et diagnostics déclarés',audiences:['admin'],
    actors:['user','delegated-user','machine'],scopes:['analytics.read'],context:'required',default:'deny',
    resources:[ref('model','event')],actions:['read','execute'],
    enforcement:{request:true,commit:true},public:false}];
const errors=['invalid_input','unauthorized','forbidden','not_found','conflict','rate_limited','unavailable','unknown']
  .map(code=>({code,retryable:['rate_limited','unavailable','unknown'].includes(code),
    outcome:code==='unknown'?'unknown':'rejected'}));
const definitions=[
  ['event.record','Déclarer un événement','command',recordInput,recordOutput,'eventRecord','emit',['admin','app']],
  ['event.list','Lister les événements','query',listInput,listOutput,'eventList','read',['admin']],
  ['analytics.snapshot','Mesures déclarées','query',snapshotInput,snapshotOutput,'analyticsSnapshot','read',['admin']],
  ['event.export','Exporter une page d’événements','query',exportInput,exportOutput,'eventExport','read',['admin']]];
const operations=definitions.map(([name,title,kind,input,output,handler,permission,audiences])=>({
  id:name,title,kind,input,output,permissions:[ref('permission',permission)],audiences,
  actors:['user','delegated-user','machine'],context:'required',handler:{path:'module/operations.ts',export:handler},
  effects:{reads:kind==='query'?[ref('model','event')]:[],writes:kind==='command'?[ref('model','event')]:[],
    emits:[],calls:[],providers:[]},errors,
  pagination:name==='event.list'||name==='event.export'?{mode:'cursor',cursorField:'cursor',
    limitField:'limit',maxItems:50}:{mode:'none'},
  idempotency:kind==='command'?{mode:'required',keyField:'requestKey',scope:'actor-context-operation',
    retentionSeconds:86400}:{mode:'none'},approval:{mode:'none'},concurrency:{mode:'none'},
  execution:{maxDurationMs:10000,maxItems:kind==='query'?500:1,resumable:false},
  audit:{required:true,redactFields:['content']},public:false}));
const api=[];
for(const operation of operations)for(const audience of operation.audiences){
  const spec=schemas.find(s=>s.id===operation.input.schemaId).schema;
  api.push({id:`${audience}.${operation.id}`,method:operation.kind==='command'?'POST':'GET',
    path:`/api/${audience}/analytics/${operation.id.replaceAll('.','/')}`,
    operation:ref('operation',operation.id),audience,auth:['session','oauth','api-token'],
    parameters:operation.kind==='command'?[]:Object.entries(spec.properties)
      .filter(([,value])=>['string','integer','boolean'].includes(value.type))
      .map(([name])=>({name:name.replaceAll(/[A-Z]/g,c=>'_'+c.toLowerCase()),in:'query',inputField:name,
        required:spec.required.includes(name)})),input:operation.input,output:operation.output,
    rateLimit:{requests:60,windowSeconds:60}});
}
const manifest=structuredClone(template),revision='t22-analytics-reported-v1';
const skillPath='plugin/skills/analytics.md';
const skillIntegrity=`sha256-${createHash('sha256').update(readFileSync(new URL(skillPath,root))).digest('hex')}`;
manifest.identity={id,title:'Analytique et diagnostics',publisher:'creezio',
  origin:'https://github.com/creezio/Creezio-D1R2',version:'0.0.0',
  source:{kind:'snapshot',revision,integrity:`sha256-${createHash('sha256').update(revision).digest('hex')}`},
  license:{expression:'NOASSERTION',file:'LICENSE'}};
manifest.compatibility={core:'^0.0.0',sdk:'^1.0.0',
  requiredCapabilities:['runtime.worker','data.d1.shared'],optionalCapabilities:[]};
manifest.entrypoints={server:{path:'module/entry.server.ts',export:'analytics'},
  ui:{path:'ui/index.tsx',export:'AnalyticsAdminView'},
  plugin:{manifest:'plugin/plugin.json',mcp:'plugin/mcp.json',
    contributions:{path:'plugin/contributions.ts',export:'contributions'}}};
manifest.dependencies=[{moduleId:'creezio.access',origin:'https://github.com/creezio/Creezio-D1R2',
  versionRange:'^0.0.0',optional:false,contracts:[],whenAbsent:'block',whenIncompatible:'block',autoInstall:false}];
manifest.contracts={schemas,models:[model],files:[],events:[],settings:[],search:[],permissions,
  operations,api,mcp:{tools:operations.map(operation=>({id:operation.id,
    name:`analytics_${operation.id.replaceAll('.','_')}`,operation:ref('operation',operation.id),
    audiences:operation.audiences,auth:['oauth','api-token'],input:operation.input,output:operation.output,
    annotations:{readOnly:operation.kind==='query',destructive:false,
      idempotent:operation.kind==='query',openWorld:false},textFallback:true})),resources:[],prompts:[],
    skills:[{id:'analytics',path:skillPath,audiences:['admin'],operations:operations
      .filter(operation=>operation.audiences.includes('admin')).map(operation=>ref('operation',operation.id)),
      resources:[],integrity:skillIntegrity}]},
  ui:{views:[{id:'admin',title:'Analytique',surfaces:['workspace'],route:'/admin/analytics',
    component:{path:'ui/index.tsx',export:'AnalyticsAdminView'},permissions:[ref('permission','read')],
    operations:operations.filter(operation=>operation.audiences.includes('admin'))
      .map(operation=>ref('operation',operation.id)),input:viewInput,
    panel:{identityFields:[],navigation:'sdk',retention:'preserve',inactiveEffects:'suspend',stateSchema:panelState}}],
    navigation:[{id:'analytics-admin',title:'Analytique',view:ref('view','admin'),
      permissions:[ref('permission','read')],surfaces:['workspace'],order:70}],
    slots:[],front:{mode:'absent',justification:{reason:'Analytics are an authorized workspace view; app emission uses the API.',
      policyRule:'analytics.workspace-only'}},themes:[],styles:[]},widgets:[],publicContracts:[]};
manifest.documentation.versionBinding={moduleVersion:'0.0.0',sourceRevision:revision};
for(const suite of ['backend','ui','api-mcp','package','docs'])
  manifest.validation.suites[suite].tests=[`tests/${suite}/contract.test.mjs`];
manifest.validation.suites.widgets.mode='not-applicable';
manifest.validation.suites.widgets.tests=['tests/widgets/contract.test.mjs'];
manifest.validation.suites.widgets.justification={reason:'Analytics use the workspace view; no MCP widget renderer.',
  policyRule:'analytics.no-widget-renderer'};
manifest.packaging.runtime.files=['module/manifest.json','module/models.json','module/entry.server.ts',
  'module/operations.ts','module/service.ts','ui/index.tsx','ui/contracts.ts','ui/panel-state.ts','README.md','prd.md',
  'CHANGELOG.md','LICENSE','plugin/plugin.json','plugin/mcp.json','plugin/contributions.ts',skillPath];
manifest.packaging.validation.files=['AGENTS.md','FILES.md','interview.md','TODO.md','gate.mjs',
  'module/generate-manifest.mjs','ci/run-suite.mjs','tests/helpers.mjs',
  ...['backend','ui','api-mcp','widgets','package','docs']
    .flatMap(name=>[`ci/${name}.mjs`,`tests/${name}/contract.test.mjs`])];
manifest.packaging.validationBinding={moduleId:id,moduleVersion:'0.0.0',sourceRevision:revision};
manifest.lifecycle.absent={widgets:{reason:'Analytics have no MCP widget renderer.',
  policyRule:'analytics.no-widget-renderer'},files:{reason:'Analytics events do not store files.',
  policyRule:'analytics.no-files'}};
manifest.lifecycle.configuration='explicit-state';
writeFileSync(new URL('module/models.json',root),JSON.stringify([model],null,2)+'\n');
writeFileSync(new URL('module/manifest.json',root),JSON.stringify(manifest,null,2)+'\n');
