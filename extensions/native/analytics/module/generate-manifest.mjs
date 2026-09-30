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
  permissions:[ref('permission','emit'),ref('permission','read'),ref('permission','manage-retention')],
  deletion:{mode:'hard',requiresApproval:false},public:false};
const retentionPolicyModel={id:'retention_policy',title:'Politique de rétention manuelle',scope:'context',
  contextField:'context_id',fields:[
    field('context_id','string',{protected:true,constraints:string()}),
    field('id','string',{constraints:string(36)}),
    field('retention_days','integer',{constraints:{minimum:1,maximum:3650}}),
    field('revision','integer',{constraints:{minimum:1,maximum:Number.MAX_SAFE_INTEGER}}),
    field('updated_at','date-time')],primaryKey:['context_id','id'],indexes:[],relations:[],
  permissions:[ref('permission','manage-retention')],deletion:{mode:'soft',requiresApproval:false},public:false};
const collectionPolicyModel={id:'collection_policy',title:'Collecte optionnelle de l’installation',scope:'application',fields:[
  field('id','string',{constraints:string(36)}),
  field('revision','integer',{constraints:{minimum:1,maximum:Number.MAX_SAFE_INTEGER}}),
  field('navigation_enabled','boolean'),field('clicks_enabled','boolean'),field('refusals_enabled','boolean'),
  field('refusal_retention_days','integer',{constraints:{minimum:1,maximum:365}}),
  field('updated_at','date-time')],primaryKey:['id'],indexes:[],relations:[],
  permissions:[ref('permission','emit'),ref('permission','read'),ref('permission','manage-collection')],
  deletion:{mode:'soft',requiresApproval:false},public:false};
const refusalModel={id:'transport_refusal',title:'Refus de transport avant moteur',scope:'application',fields:[
  field('id','string',{constraints:string(36)}),
  field('transport','string',{constraints:{enum:['api','mcp']}}),
  field('method','string',{constraints:{enum:['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS']}}),
  field('route_template','string',{constraints:string(512)}),
  field('status','integer',{constraints:{minimum:400,maximum:599}}),
  field('error_code','string',{constraints:string(80)}),
  field('created_at_ms','integer',{constraints:{minimum:0,maximum:Number.MAX_SAFE_INTEGER}}),
  field('duration_ms','integer',{constraints:{minimum:0,maximum:Number.MAX_SAFE_INTEGER}})],
  primaryKey:['id'],indexes:[{id:'by-time',fields:['created_at_ms','id'],unique:false}],relations:[],
  permissions:[ref('permission','read'),ref('permission','manage-retention')],
  deletion:{mode:'hard',requiresApproval:false},public:false};
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
const summaryInput=schema('analytics-widget-summary-input',obj({cursor:str(2048)},[]));
const summaryOutput=schema('analytics-widget-summary-output',obj({period:bounds,source:{const:'reported'},
  complete:{type:'boolean'},scanned:int(0,500),nextCursor:nullable(str(2048)),
  totals:schemas.find(s=>s.id==='analytics-snapshot-output').schema.properties.totals,
  activePrincipals:int(),timeline:counts(8)}));
const widgetEvent=obj({id:str(36),type:eventType,actionId:nullable(str(80)),
  surface:str(64),path:nullable(str(256)),errorCode:nullable(str(80)),occurredAt:str(35)});
const widgetEventsInput=schema('analytics-widget-events-input',obj({period,cursor:str(2048),
  query:str(120,0),type:eventType,principalId:str()},['period']));
const widgetEventsOutput=schema('analytics-widget-events-output',obj({period:bounds,
  items:{type:'array',items:widgetEvent,maxItems:5},nextCursor:nullable(str(2048)),
  complete:{type:'boolean'},scanned:int(0,500)}));
const diagnosticExecutionsInput=schema('diagnostics-executions-input',obj({period,limit:int(1,50),
  cursor:str(2048)},['period','limit']));
const diagnosticExecution=obj({id:str(128),moduleId:str(128),operationId:str(128),
  audience:{type:'string',enum:['admin','app']},state:{type:'string',enum:['running','waiting','succeeded','failed','unknown']},
  errorCode:nullable(str(128)),createdAt:str(35),updatedAt:str(35),durationMs:nullable(int())});
const diagnosticExecutionsOutput=schema('diagnostics-executions-output',obj({period:bounds,
  items:{type:'array',items:diagnosticExecution,maxItems:50},nextCursor:nullable(str(2048)),complete:{type:'boolean'}}));
const diagnosticEndpointsInput=schema('diagnostics-endpoints-input',obj({limit:int(1,50),cursor:str(2048)},['limit']));
const diagnosticEndpoint=obj({moduleId:str(128),operationId:str(128),
  audience:{type:'string',enum:['admin','app']},method:{type:'string',enum:['GET','POST','PUT','PATCH','DELETE']},
  path:str(512),kind:{type:'string',enum:['query','command']}});
const diagnosticEndpointsOutput=schema('diagnostics-endpoints-output',obj({
  items:{type:'array',items:diagnosticEndpoint,maxItems:50},nextCursor:nullable(str(2048)),
  complete:{type:'boolean'},source:{type:'string',enum:['compiled-http-bindings','unavailable']}}));
const collectionPolicy=obj({configured:{type:'boolean'},revision:int(),navigation:{type:'boolean'},
  clicks:{type:'boolean'},refusals:{type:'boolean'},refusalRetentionDays:int(1,365),manualOnly:{const:true}});
const collectionPolicyInput=schema('collection-policy-input',obj({}));
const collectionPolicyOutput=schema('collection-policy-output',collectionPolicy);
const collectionEffectiveOutput=schema('collection-effective-output',obj({navigation:{type:'boolean'},clicks:{type:'boolean'}}));
const collectionConfigureInput=schema('collection-configure-input',obj({requestKey:str(),expectedRevision:int(),
  navigation:{type:'boolean'},clicks:{type:'boolean'},refusals:{type:'boolean'},refusalRetentionDays:int(1,365)}));
const refusalItem=obj({id:str(128),transport:{type:'string',enum:['api','mcp']},method:str(8),
  routeTemplate:str(512),status:int(400,599),errorCode:str(80),occurredAt:str(35),durationMs:int()});
const refusalListInput=schema('refusals-list-input',obj({limit:int(1,50),cursor:str(2048)},['limit']));
const refusalListOutput=schema('refusals-list-output',obj({items:{type:'array',items:refusalItem,maxItems:50},
  nextCursor:nullable(str(2048)),complete:{type:'boolean'}}));
const refusalPreviewInput=schema('refusals-preview-input',obj({}));
const refusalPurgeItem=obj({id:str(128),occurredAt:str(35)});
const refusalPreviewOutput=schema('refusals-preview-output',obj({revision:int(),cutoff:str(35),
  items:{type:'array',items:refusalPurgeItem,maxItems:10},hasMore:{type:'boolean'},manualOnly:{const:true}}));
const refusalPurgeInput=schema('refusals-purge-input',obj({requestKey:str(),revision:int(),cutoff:str(35),
  items:{type:'array',items:refusalPurgeItem,minItems:1,maxItems:10}}));
const refusalPurgeOutput=schema('refusals-purge-output',obj({deleted:int(0,10),hasMore:{type:'boolean'},
  cutoff:str(35),revision:int()}));
const retentionPolicyOutput=schema('retention-policy-output',obj({configured:{type:'boolean'},
  retentionDays:nullable(int(1,3650)),revision:int(),manualOnly:{const:true}}));
const retentionPolicyInput=schema('retention-policy-input',obj({}));
const retentionConfigureInput=schema('retention-configure-input',obj({requestKey:str(),
  retentionDays:int(1,3650),expectedRevision:int()}));
const purgeItem=obj({id:str(36),occurredAt:str(35)});
const retentionPreviewInput=schema('retention-preview-input',obj({}));
const retentionPreviewOutput=schema('retention-preview-output',obj({
  ...schemas.find(s=>s.id==='retention-policy-output').schema.properties,
  cutoff:nullable(str(35)),items:{type:'array',items:purgeItem,maxItems:10},hasMore:{type:'boolean'}}));
const retentionPurgeInput=schema('retention-purge-input',obj({requestKey:str(),revision:int(),
  cutoff:str(35),items:{type:'array',items:purgeItem,minItems:1,maxItems:10}}));
const retentionPurgeOutput=schema('retention-purge-output',obj({deleted:int(0,10),
  hasMore:{type:'boolean'},cutoff:str(35),revision:int()}));
const viewInput=schema('analytics-view-input',obj({}));
const pendingCommand=obj({sessionId:str(128),audience:{type:'string',enum:['admin','app']},
  contextId:str(128),bindingId:str(257),requestKey:str(512),intent:str(64)},
  ['sessionId','audience','contextId','bindingId','requestKey']);
const panelState=schema('analytics-panel-state',obj({sessionId:str(128),
  audience:{type:'string',enum:['admin','app']},contextId:str(128),
  period,query:str(120,0),type:str(16,0),principalId:str(128,0),pending:pendingCommand},
['sessionId','audience','contextId','period','query','type','principalId']));
const permissions=[
  {id:'emit',title:'Déclarer un événement analytique',audiences:['admin','app'],
    actors:['user','delegated-user','machine'],scopes:['analytics.emit'],context:'required',default:'deny',
    resources:[ref('model','event'),ref('model','collection_policy')],actions:['read','create','execute'],
    enforcement:{request:true,commit:true},public:false},
  {id:'read',title:'Lire les événements et diagnostics déclarés',audiences:['admin'],
    actors:['user','delegated-user','machine'],scopes:['analytics.read'],context:'required',default:'deny',
    resources:[ref('model','event'),ref('model','collection_policy'),ref('model','transport_refusal')],actions:['read','execute'],
    enforcement:{request:true,commit:true},public:false},
  {id:'manage-retention',title:'Configurer et exécuter les purges manuelles Analytics',audiences:['admin'],
    actors:['user','delegated-user'],scopes:['analytics.purge'],context:'required',default:'deny',
    resources:[ref('model','event'),ref('model','retention_policy'),ref('model','collection_policy'),ref('model','transport_refusal')],
    actions:['read','create','update','delete','execute'],
    enforcement:{request:true,commit:true},public:false},
  {id:'manage-collection',title:'Configurer la collecte analytique optionnelle',audiences:['admin'],
    actors:['user','delegated-user'],scopes:['analytics.configure'],context:'required',default:'deny',
    resources:[ref('model','collection_policy')],actions:['read','create','update','execute'],
    enforcement:{request:true,commit:true},public:false}];
const errors=['invalid_input','unauthorized','forbidden','not_found','conflict','rate_limited','unavailable','unknown']
  .map(code=>({code,retryable:['rate_limited','unavailable','unknown'].includes(code),
    outcome:code==='unknown'?'unknown':'rejected'}));
const definitions=[
  ['event.record','Déclarer un événement','command',recordInput,recordOutput,'eventRecord','emit',['admin','app']],
  ['event.list','Lister les événements','query',listInput,listOutput,'eventList','read',['admin']],
  ['analytics.snapshot','Mesures déclarées','query',snapshotInput,snapshotOutput,'analyticsSnapshot','read',['admin']],
  ['event.export','Exporter une page d’événements','query',exportInput,exportOutput,'eventExport','read',['admin']],
  ['analytics.widget.summary','Résumé des événements déclarés sur sept jours','query',summaryInput,summaryOutput,
    'widgetSummary','read',['admin']],
  ['analytics.widget.events','Cinq événements déclarés','query',widgetEventsInput,widgetEventsOutput,
    'widgetEvents','read',['admin']],
  ['diagnostics.executions','Journal technique des opérations','query',diagnosticExecutionsInput,
    diagnosticExecutionsOutput,'diagnosticsExecutions','read',['admin']],
  ['diagnostics.endpoints','Registre des routes déclarées','query',diagnosticEndpointsInput,
    diagnosticEndpointsOutput,'diagnosticsEndpoints','read',['admin']],
  ['collection.policy','Politique de collecte','query',collectionPolicyInput,
    collectionPolicyOutput,'collectionPolicy','read',['admin']],
  ['collection.effective','Collecte autorisée sur ce client','query',collectionPolicyInput,
    collectionEffectiveOutput,'collectionEffective','emit',['admin','app']],
  ['collection.configure','Configurer la collecte','command',collectionConfigureInput,
    collectionPolicyOutput,'collectionConfigure','manage-collection',['admin']],
  ['refusals.list','Refus avant moteur','query',refusalListInput,
    refusalListOutput,'refusalsList','read',['admin']],
  ['refusals.preview','Prévisualiser les refus expirés','query',refusalPreviewInput,
    refusalPreviewOutput,'refusalsPreview','manage-retention',['admin']],
  ['refusals.purge','Purger un lot de refus expirés','command',refusalPurgeInput,
    refusalPurgeOutput,'refusalsPurge','manage-retention',['admin']],
  ['retention.policy','Politique de rétention','query',retentionPolicyInput,
    retentionPolicyOutput,'retentionPolicy','manage-retention',['admin']],
  ['retention.configure','Configurer la rétention manuelle','command',retentionConfigureInput,
    retentionPolicyOutput,'retentionConfigure','manage-retention',['admin']],
  ['retention.preview','Prévisualiser les événements admissibles','query',retentionPreviewInput,
    retentionPreviewOutput,'retentionPreview','manage-retention',['admin']],
  ['retention.purge','Purger le lot prévisualisé','command',retentionPurgeInput,
    retentionPurgeOutput,'retentionPurge','manage-retention',['admin']]];
const policyRef=ref('model','retention_policy'),eventRef=ref('model','event');
const retentionEffects={
  'retention.policy':{reads:[policyRef],writes:[]},
  'retention.configure':{reads:[policyRef],writes:[policyRef]},
  'retention.preview':{reads:[policyRef,eventRef],writes:[]},
  'retention.purge':{reads:[policyRef,eventRef],writes:[eventRef]}};
const collectionRef=ref('model','collection_policy'),refusalRef=ref('model','transport_refusal');
const hostEffects={
  'collection.policy':{reads:[collectionRef],writes:[]},
  'collection.effective':{reads:[collectionRef],writes:[]},
  'collection.configure':{reads:[collectionRef],writes:[collectionRef]},
  'refusals.list':{reads:[refusalRef],writes:[]},
  'refusals.preview':{reads:[collectionRef,refusalRef],writes:[]},
  'refusals.purge':{reads:[collectionRef,refusalRef],writes:[refusalRef]}};
const operations=definitions.map(([name,title,kind,input,output,handler,permission,audiences])=>({
  id:name,title,kind,input,output,permissions:[ref('permission',permission)],audiences,
  actors:name.startsWith('retention.')||name==='collection.configure'||name==='refusals.preview'||name==='refusals.purge'
    ?['user','delegated-user']:['user','delegated-user','machine'],
  context:'required',handler:{path:'module/operations.ts',export:handler},
  effects:{reads:retentionEffects[name]?.reads??hostEffects[name]?.reads??(kind==='query'&&!name.startsWith('diagnostics.')?[eventRef]:[]),
    writes:retentionEffects[name]?.writes??hostEffects[name]?.writes??(kind==='command'?[eventRef]:[]),
    emits:[],calls:[],providers:[]},errors,
  pagination:name==='event.list'||name==='event.export'||name==='refusals.list'?{mode:'cursor',cursorField:'cursor',
    limitField:'limit',maxItems:50}:{mode:'none'},
  idempotency:kind==='command'?{mode:'required',keyField:'requestKey',scope:'actor-context-operation',
    retentionSeconds:86400}:{mode:'none'},approval:{mode:'none'},concurrency:{mode:'none'},
  execution:{maxDurationMs:10000,maxItems:name==='retention.purge'||name==='refusals.purge'?23
    :name==='retention.configure'||name==='collection.configure'?2
      :name==='retention.preview'?12:kind==='query'?500:1,resumable:false},
  audit:{required:true,redactFields:['content']},public:false}));
const api=[];
for(const operation of operations)for(const audience of operation.audiences){
  const spec=schemas.find(s=>s.id===operation.input.schemaId).schema;
  api.push({id:`${audience}.${operation.id}`,method:operation.kind==='command'?'POST':'GET',
    path:`/api/${audience}/analytics/${operation.id.replaceAll('.','/')}`,
    operation:ref('operation',operation.id),audience,
    auth:operation.id.startsWith('retention.')||operation.id==='collection.configure'||operation.id==='refusals.preview'||operation.id==='refusals.purge'
      ?['session','oauth']:['session','oauth','api-token'],
    parameters:operation.kind==='command'?[]:Object.entries(spec.properties)
      .filter(([,value])=>['string','integer','boolean'].includes(value.type))
      .map(([name])=>({name:name.replaceAll(/[A-Z]/g,c=>'_'+c.toLowerCase()),in:'query',inputField:name,
        required:spec.required.includes(name)})),input:operation.input,output:operation.output,
    rateLimit:{requests:60,windowSeconds:60}});
}
const manifest=structuredClone(template),revision='t22-analytics-collection-v4';
const skillPath='plugin/skills/analytics.md';
const skillIntegrity=`sha256-${createHash('sha256').update(readFileSync(new URL(skillPath,root))).digest('hex')}`;
manifest.identity={id,title:'Analytique et diagnostics',publisher:'creezio',
  origin:'https://github.com/creezio/Creezio-D1R2',version:'0.0.0',
  source:{kind:'snapshot',revision,integrity:`sha256-${createHash('sha256').update(revision).digest('hex')}`},
  license:{expression:'NOASSERTION',file:'LICENSE'}};
manifest.compatibility={core:'^0.0.0',sdk:'^1.8.0',
  requiredCapabilities:['runtime.worker','data.d1.shared'],optionalCapabilities:[]};
manifest.entrypoints={server:{path:'module/entry.server.ts',export:'analytics'},
  ui:{path:'ui/index.tsx',export:'AnalyticsAdminView'},
  plugin:{manifest:'plugin/plugin.json',mcp:'plugin/mcp.json',
    contributions:{path:'plugin/contributions.ts',export:'contributions'}}};
manifest.dependencies=[{moduleId:'creezio.access',origin:'https://github.com/creezio/Creezio-D1R2',
  versionRange:'^0.0.0',optional:false,contracts:[],whenAbsent:'block',whenIncompatible:'block',autoInstall:false}];
const widgetNames=['summary','events'];
const widgetOperation={summary:'analytics.widget.summary',events:'analytics.widget.events'};
const widgetInput={summary:summaryInput,events:widgetEventsInput};
const widgetOutput={summary:summaryOutput,events:widgetEventsOutput};
const widgetState=schema('analytics-widget-state',obj({period,cursor:str(2048)},[]));
const widgetResource=name=>({id:`${name}-ui`,uri:`ui://${id}/${name}`,
  mimeType:'text/html;profile=mcp-app',audiences:['admin'],permissions:[ref('permission','read')],
  source:{kind:'asset',path:`ui/widgets/${name}.html`},widget:ref('widget',name),
  ui:{csp:{connectDomains:[],resourceDomains:[],frameDomains:[],baseUriDomains:[]},
    permissions:{},prefersBorder:true}});
const widget=name=>({id:name,version:'1.0.0',compatibility:'^1.0.0',resource:`${name}-ui`,
  renderer:{path:`ui/widgets/${name}.ts`,export:`start${name[0].toUpperCase()+name.slice(1)}`},
  input:widgetOutput[name],state:widgetState,result:widgetOutput[name],
  audiences:['admin'],permissions:[ref('permission','read')],requiredCapabilities:[],assets:[],
  actions:[{id:'read',label:'Lire',input:widgetInput[name],requiredCapabilities:[],
    fallback:'unavailable',mode:'direct',target:{kind:'operation',operation:ref('operation',widgetOperation[name])}}],
  instance:{identity:'host-generated',revision:'monotonic',correlation:'request-instance-conversation',
    objectVersion:'distinct',lateResponse:'reject-stale'},
  transport:{protocol:'mcp-apps',maxPayloadBytes:65536,timeoutMs:15000,
    uncertainResult:'reconcile-before-retry',fallbackDispatch:'before-first-dispatch-only'}});
manifest.contracts={schemas,models:[model,retentionPolicyModel,collectionPolicyModel,refusalModel],files:[],events:[],settings:[],search:[],permissions,
  operations,api,mcp:{tools:operations.map(operation=>({id:operation.id,
    name:`analytics_${operation.id.replaceAll('.','_')}`,operation:ref('operation',operation.id),
    audiences:operation.audiences,auth:operation.id.startsWith('retention.')||operation.id==='collection.configure'||operation.id==='refusals.preview'||operation.id==='refusals.purge'
      ?['oauth']:['oauth','api-token'],
    input:operation.input,output:operation.output,
    annotations:{readOnly:operation.kind==='query',destructive:operation.id==='retention.purge'||operation.id==='refusals.purge',
      idempotent:operation.kind==='query',openWorld:false},
    ...(Object.entries(widgetOperation).find(([,op])=>op===operation.id)
      ?{widget:ref('widget',Object.entries(widgetOperation).find(([,op])=>op===operation.id)[0])}:{}),
    textFallback:true})),resources:widgetNames.map(widgetResource),prompts:[],
    skills:[{id:'analytics',path:skillPath,audiences:['admin'],operations:operations
      .filter(operation=>operation.audiences.includes('admin')).map(operation=>ref('operation',operation.id)),
      resources:widgetNames.map(name=>`${name}-ui`),integrity:skillIntegrity}]},
  ui:{views:[{id:'admin',title:'Analytique',surfaces:['workspace'],route:'/admin/analytics',
    component:{path:'ui/index.tsx',export:'AnalyticsAdminView'},permissions:[ref('permission','read')],
    operations:operations.filter(operation=>operation.audiences.includes('admin'))
      .map(operation=>ref('operation',operation.id)),input:viewInput,
    panel:{identityFields:[],navigation:'sdk',retention:'preserve',inactiveEffects:'suspend',stateSchema:panelState}}],
    navigation:[{id:'analytics-admin',title:'Analytique',view:ref('view','admin'),
      permissions:[ref('permission','read')],surfaces:['workspace'],order:70}],
    slots:[],front:{mode:'absent',justification:{reason:'Analytics are an authorized workspace view; app emission uses the API.',
      policyRule:'analytics.workspace-only'}},themes:[],styles:[]},widgets:widgetNames.map(widget),publicContracts:[]};
manifest.documentation.versionBinding={moduleVersion:'0.0.0',sourceRevision:revision};
for(const suite of ['backend','ui','api-mcp','package','docs'])
  manifest.validation.suites[suite].tests=[`tests/${suite}/contract.test.mjs`];
manifest.validation.suites.widgets.mode='required';
manifest.validation.suites.widgets.tests=['tests/widgets/contract.test.mjs','tests/widgets/runtime.test.mjs'];
delete manifest.validation.suites.widgets.justification;
manifest.packaging.runtime.files=['module/manifest.json','module/models.json','module/entry.server.ts',
  'module/operations.ts','module/service.ts','ui/index.tsx','ui/contracts.ts','ui/panel-state.ts','ui/export.ts',
  'ui/retention.tsx','ui/collection.tsx',
  'ui/widgets/runtime.ts',...widgetNames.flatMap(name=>[`ui/widgets/${name}.ts`,`ui/widgets/${name}.html`]),
  'README.md','prd.md',
  'CHANGELOG.md','LICENSE','plugin/plugin.json','plugin/mcp.json','plugin/contributions.ts',skillPath];
manifest.packaging.validation.files=['AGENTS.md','FILES.md','interview.md','TODO.md','gate.mjs',
  'module/generate-manifest.mjs','ci/run-suite.mjs','tests/helpers.mjs',
  ...['backend','ui','api-mcp','widgets','package','docs']
    .flatMap(name=>[`ci/${name}.mjs`,`tests/${name}/contract.test.mjs`]),'tests/widgets/runtime.test.mjs'];
manifest.packaging.validationBinding={moduleId:id,moduleVersion:'0.0.0',sourceRevision:revision};
manifest.lifecycle.absent={files:{reason:'Analytics events do not store files.',
  policyRule:'analytics.no-files'}};
manifest.lifecycle.configuration='explicit-state';
writeFileSync(new URL('module/models.json',root),JSON.stringify([model,retentionPolicyModel,collectionPolicyModel,refusalModel],null,2)+'\n');
writeFileSync(new URL('module/manifest.json',root),JSON.stringify(manifest,null,2)+'\n');
