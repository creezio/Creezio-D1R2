import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {granolaConnectorDescriptor} from './storage.ts';

const root=new URL('../',import.meta.url);
const template=JSON.parse(readFileSync(new URL('module/manifest.json',root),'utf8'));
const id='creezio.granola',connectorId='granola.api.v1',version='0.1.0',sourceRevision='t29-granola-notes-v1';
const ref=(kind,name)=>({moduleId:id,kind,id:name});
const str=(max=128,min=1)=>({type:'string',minLength:min,maxLength:max});
const num=(min=0,max=Number.MAX_SAFE_INTEGER)=>({type:'integer',minimum:min,maximum:max});
const nullable=value=>({anyOf:[value,{type:'null'}]});
const obj=(properties,required=Object.keys(properties))=>({type:'object',properties,required,additionalProperties:false});
const array=(items,maxItems)=>({type:'array',items,maxItems});
const field=(id,type,options={})=>({id,type,nullable:options.nullable??false,
  protected:options.protected??false,computed:false,...(options.constraints?{constraints:options.constraints}:{})});
const fields=[];
const model=(name,title,columns,permissions,indexes=[])=>fields.push({id:name,title,scope:'context',contextField:'context_id',
  fields:[field('context_id','string',{protected:true,constraints:{minLength:1,maxLength:128}}),...columns],
  primaryKey:['context_id','id'],indexes,relations:[],permissions:permissions.map(name=>ref('permission',name)),
  deletion:{mode:'soft',requiresApproval:false},public:false});
const idField=field('id','string',{constraints:{minLength:1,maxLength:128}}),
  revField=field('revision','integer',{constraints:{minimum:1}}),
  connectionField=field('connection_id','string',{constraints:{minLength:1,maxLength:128}}),
  syncedField=field('synced_at','date-time');
model('connector_config','Connexion Granola',[idField,field('origin','string',{constraints:{minLength:8,maxLength:512}}),
  field('key_ref','string',{nullable:true,constraints:{minLength:1,maxLength:128}}),
  field('secret_version','integer',{nullable:true,constraints:{minimum:1}}),
  field('connection_id','string',{nullable:true,constraints:{minLength:1,maxLength:128}}),
  field('webhook_key_ref','string',{nullable:true,constraints:{minLength:1,maxLength:128}}),
  field('webhook_secret_version','integer',{nullable:true,constraints:{minimum:1}}),
  field('webhook_previous_key_ref','string',{nullable:true,constraints:{minLength:1,maxLength:128}}),
  field('webhook_previous_secret_version','integer',{nullable:true,constraints:{minimum:1}}),
  field('webhook_service_token_ref','string',{nullable:true,constraints:{minLength:1,maxLength:128}}),
  field('webhook_service_token_version','integer',{nullable:true,constraints:{minimum:1}}),
  field('enabled','boolean'),revField,field('updated_at','date-time')],['manage','read']);
model('connector_secret','Clé Granola scellée',[
  field('id','string',{protected:true,constraints:{minLength:1,maxLength:128}}),
  field('binding_id','string',{protected:true,constraints:{minLength:1,maxLength:128}}),
  field('ciphertext','string',{protected:true,constraints:{minLength:1,maxLength:32768}}),
  field('key_id','string',{protected:true,constraints:{minLength:1,maxLength:128}}),
  field('version','integer',{protected:true,constraints:{minimum:1}}),
  field('state','string',{protected:true,constraints:{enum:['active','revoked']}})],['manage','read']);
model('sync_state','Checkpoint de synchronisation Granola',[
  field('id','string',{constraints:{enum:['notes','folders']}}),field('run_id','string',{constraints:{minLength:1,maxLength:128}}),
  connectionField,field('cursor','string',{nullable:true,constraints:{minLength:1,maxLength:512}}),
  field('status','string',{constraints:{enum:['partial','pages_exhausted']}}),revField,
  field('updated_at','date-time')],['manage','read']);
model('note','Note Granola projetée',[idField,connectionField,
  field('title','string',{nullable:true,constraints:{minLength:0,maxLength:1000}}),
  field('owner','string',{nullable:true,constraints:{minLength:0,maxLength:256}}),
  field('note_created_at','date-time',{nullable:true}),field('note_updated_at','date-time',{nullable:true}),
  field('folder_id','string',{nullable:true,constraints:{minLength:1,maxLength:64}}),
  field('summary_text','string',{nullable:true,constraints:{minLength:0,maxLength:16000}}),
  field('web_url','string',{nullable:true,constraints:{minLength:0,maxLength:2048}}),
  revField,syncedField],['manage','read'],
  [{id:'by-connection',fields:['context_id','connection_id','id'],unique:false}]);
model('folder','Dossier Granola projeté',[idField,connectionField,
  field('name','string',{constraints:{minLength:0,maxLength:500}}),
  field('parent_folder_id','string',{nullable:true,constraints:{minLength:1,maxLength:64}}),
  revField,syncedField],['manage','read'],
  [{id:'by-connection',fields:['context_id','connection_id','id'],unique:false}]);
model('transcript_segment','Segment Granola projeté',[idField,connectionField,
  field('note_id','string',{constraints:{minLength:1,maxLength:64}}),
  field('text','string',{constraints:{minLength:0,maxLength:8192}}),
  field('speaker_name','string',{nullable:true,constraints:{minLength:0,maxLength:256}}),
  field('start_time','date-time'),field('end_time','date-time'),revField,syncedField],['manage','read'],
  [{id:'by-note',fields:['context_id','connection_id','note_id','id'],unique:false}]);
model('webhook_event','Réception Granola signée',[idField,connectionField,
  field('event_type','string',{constraints:{enum:['note.generated','note.edited','note.access_granted']}}),
  field('note_id','string',{constraints:{minLength:1,maxLength:64}}),
  field('occurred_at','date-time'),field('body_digest','string',{constraints:{minLength:64,maxLength:64}}),
  revField,field('received_at','date-time')],['manage','read'],
  [{id:'by-connection',fields:['context_id','connection_id','id'],unique:false}]);
const schemas=[],schema=(name,value)=>{schemas.push({id:name,schema:value});return {schemaId:name};};
const empty=schema('empty-input',obj({})),requestKey=str(128),revision=num();
const configView=obj({origin:str(128),enabled:{type:'boolean'},hasKey:{type:'boolean'},
  hasWebhookSecret:{type:'boolean'},hasWebhookService:{type:'boolean'},
  state:{type:'string',enum:['missing','configured','unverified']},revision});
const configOutput=schema('config-output',obj({config:configView}));
const configInput=schema('config-set-input',obj({requestKey,enabled:{type:'boolean'},revision}));
const keyInput=schema('config-key-input',obj({requestKey,apiKey:str(4096,8),revision}));
const revokeInput=schema('config-revoke-input',obj({requestKey,revision}));
const webhookSetInput=schema('webhook-secret-set-input',obj({requestKey,webhookSecret:str(512,16),revision}));
const webhookServiceInput=schema('webhook-service-set-input',obj({requestKey,serviceToken:str(256,32),revision}));
const eventInput=schema('webhook-event-input',obj({requestKey,eventId:str(64),bodyDigest:str(64,64),
  eventType:{type:'string',enum:['note.generated','note.edited','note.access_granted']},
  noteId:str(64),occurredAt:str(40)}));
const eventOutput=schema('webhook-event-output',obj({eventId:str(64),recorded:{const:true}}));
const checkOutput=schema('check-output',obj({reachable:{type:'boolean'}}));
const state=obj({collection:{type:'string',enum:['notes','folders']},runId:nullable(str(128)),
  cursor:nullable(str(512)),status:{type:'string',enum:['partial','pages_exhausted']},
  revision,updatedAt:nullable(str(40))});
const statesOutput=schema('states-output',obj({states:array(state,2)}));
const stateOutput=schema('state-output',obj({state}));
const syncStartInput=schema('sync-start-input',obj({requestKey,collection:{type:'string',enum:['notes','folders']},
  runId:str(128),revision}));
const syncPageInput=schema('sync-page-input',obj({requestKey,collection:{type:'string',enum:['notes','folders']},
  runId:str(128),cursor:nullable(str(512)),limit:num(1,8),expectedRevision:revision}));
const syncPageOutput=schema('sync-page-output',obj({state,processed:num(0,8)}));
const note=obj({id:str(64),title:nullable(str(1000,0)),
  owner:nullable(str(256,0)),note_created_at:nullable(str(40)),note_updated_at:nullable(str(40)),
  folder_id:nullable(str(64)),summary_text:nullable(str(16000,0)),web_url:nullable(str(2048,0)),
  synced_at:str(40)},['id','title','owner','note_created_at','note_updated_at','synced_at']);
const folder=obj({id:str(64),name:str(500,0),
  parent_folder_id:nullable(str(64)),synced_at:str(40)});
const listInput=schema('list-input',obj({limit:num(1,25),cursor:str(128)},['limit']));
const noteListOutput=schema('note-list-output',obj({items:array(note,25),nextCursor:nullable(str(128))}));
const folderListOutput=schema('folder-list-output',obj({items:array(folder,25),nextCursor:nullable(str(128))}));
const idInput=schema('note-id-input',obj({id:str(64)}));
const noteOutput=schema('note-output',obj({note}));
const refreshOutput=schema('note-refresh-output',obj({note:nullable(note),removed:{type:'boolean'}}));
const refreshInput=schema('note-refresh-input',obj({requestKey,id:str(64)}));
const segment=obj({id:str(80),note_id:str(64),text:str(8192,0),speaker_name:nullable(str(256,0)),
  start_time:str(40),end_time:str(40)});
const transcriptInput=schema('transcript-input',obj({id:str(64),cursor:nullable(str(512)),limit:num(1,25)},['id','limit']));
const transcriptOutput=schema('transcript-output',obj({note_id:str(64),segments:array(segment,25),nextCursor:nullable(str(512))}));
const panelState=schema('granola-panel-state',obj({sessionId:str(128),audience:{type:'string',enum:['admin','app']},
  contextId:str(128),pending:obj({sessionId:str(128),audience:{type:'string',enum:['admin','app']},
    contextId:str(128),bindingId:str(257),requestKey:str(512),intent:str(64),targetId:str(128)},
  ['sessionId','audience','contextId','bindingId','requestKey'])},[]));
const viewInput=schema('granola-view-input',obj({}));
const permissions=[
  {id:'manage',title:'Administrer Granola',audiences:['admin'],actors:['user','delegated-user','machine'],
    scopes:['granola.manage'],context:'required',default:'deny',resources:fields.map(item=>ref('model',item.id)),
    actions:['read','create','update','execute'],enforcement:{request:true,commit:true},public:false},
  {id:'read',title:'Lire les notes Granola',audiences:['admin','app'],actors:['user','delegated-user','machine'],
    scopes:['granola.read'],context:'required',default:'deny',resources:['connector_config','connector_secret','note','folder','transcript_segment','sync_state','webhook_event']
      .map(name=>ref('model',name)),actions:['read','execute'],enforcement:{request:true,commit:true},public:false}
];
const errors=['invalid_input','unauthorized','forbidden','not_found','conflict','rate_limited','unsupported','unavailable','unknown']
  .map(code=>({code,retryable:['rate_limited','unavailable','unknown'].includes(code),
    outcome:code==='unknown'?'unknown':'rejected'}));
const operations=[];
function operation(name,title,kind,input,output,permission,reads,writes,options={}){
  const command=kind==='command',audiences=permission==='manage'?['admin']:['admin','app'];
  operations.push({id:name,title,kind,input,output,permissions:[ref('permission',permission)],audiences,
    actors:['user','delegated-user','machine'],context:'required',
    handler:{path:'module/operations.ts',export:options.exportName},
    effects:{reads:reads.map(name=>ref('model',name)),writes:writes.map(name=>ref('model',name)),emits:[],calls:[],
      providers:options.remote?[connectorId]:[]},errors,
    pagination:options.pagination??{mode:'none'},
    idempotency:command?{mode:'required',keyField:'requestKey',scope:'actor-context-operation',retentionSeconds:86400}:{mode:'none'},
    approval:{mode:'none'},concurrency:options.cas?{mode:'object-version',versionField:'revision'}:{mode:'none'},
    execution:{maxDurationMs:10000,maxItems:options.maxItems??4,resumable:false},
    audit:{required:true,redactFields:['apiKey','webhookSecret','serviceToken']},public:false});
}
operation('config.read','Lire la connexion Granola','query',empty,configOutput,'manage',['connector_config'],[],{exportName:'configRead'});
operation('config.set','Activer la connexion Granola','command',configInput,configOutput,'manage',
  ['connector_config'],['connector_config'],{exportName:'configSet'});
operation('config.key.set','Sceller une clé Granola','command',keyInput,configOutput,'manage',
  ['connector_config','connector_secret'],['connector_config','connector_secret'],{exportName:'configKeySet',cas:true,maxItems:8});
operation('config.key.revoke','Révoquer la clé Granola','command',revokeInput,configOutput,'manage',
  ['connector_config','connector_secret'],['connector_config','connector_secret'],{exportName:'configKeyRevoke',cas:true,maxItems:8});
operation('config.key.webhook.set','Sceller le secret webhook Granola','command',webhookSetInput,configOutput,'manage',
  ['connector_config','connector_secret'],['connector_config','connector_secret'],{exportName:'configWebhookSet',cas:true,maxItems:6});
operation('config.key.webhook.revoke','Révoquer le secret webhook Granola','command',revokeInput,configOutput,'manage',
  ['connector_config','connector_secret'],['connector_config','connector_secret'],{exportName:'configWebhookRevoke',cas:true,maxItems:6});
operation('config.key.webhook.service.set','Sceller le jeton de service webhook','command',webhookServiceInput,configOutput,'manage',
  ['connector_config','connector_secret'],['connector_config','connector_secret'],{exportName:'configWebhookServiceSet',cas:true,maxItems:6});
operation('config.key.webhook.service.revoke','Révoquer le jeton de service webhook','command',revokeInput,configOutput,'manage',
  ['connector_config','connector_secret'],['connector_config','connector_secret'],{exportName:'configWebhookServiceRevoke',cas:true,maxItems:6});
operation('event.receive','Enregistrer un événement Granola signé','command',eventInput,eventOutput,'manage',
  ['connector_config','webhook_event'],['webhook_event'],{exportName:'eventReceive',maxItems:4});
operations.at(-1).actors.push('signed-webhook');
operation('connection.check','Vérifier la connexion Granola','query',empty,checkOutput,'manage',
  ['connector_config'],[],{exportName:'connectionCheck',remote:true});
operation('sync.state','Lire le checkpoint','query',empty,statesOutput,'manage',
  ['connector_config','sync_state'],[],{exportName:'syncState'});
operation('sync.start','Démarrer une synchronisation bornée','command',syncStartInput,stateOutput,'manage',
  ['connector_config','sync_state'],['sync_state'],{exportName:'syncStart',maxItems:4});
operation('sync.page','Projeter une page Granola','command',syncPageInput,syncPageOutput,'manage',
  ['connector_config','connector_secret','sync_state','note','folder'],['sync_state','note','folder'],
  {exportName:'syncPage',remote:true,maxItems:24});
for(const [name,output,model,exportName] of [
  ['note.list',noteListOutput,'note','noteList'],['folder.list',folderListOutput,'folder','folderList']])
  operation(name,`Lire ${model} projeté`, 'query',listInput,output,'read',
    ['connector_config',model],[],{exportName,maxItems:27,
      pagination:{mode:'cursor',cursorField:'cursor',limitField:'limit',maxItems:25}});
operation('note.detail','Lire une note projetée','query',idInput,noteOutput,'read',
  ['connector_config','note'],[],{exportName:'noteDetail'});
operation('note.refresh','Actualiser une note précise','command',refreshInput,refreshOutput,'manage',
  ['connector_config','connector_secret','note'],['note'],{exportName:'noteRefresh',remote:true,maxItems:8});
operation('transcript.page','Lire une page de transcription','query',transcriptInput,transcriptOutput,'read',
  ['connector_config','note'],[],{exportName:'transcriptPage',remote:true,maxItems:27,
    pagination:{mode:'cursor',cursorField:'cursor',limitField:'limit',maxItems:25}});
const api=[];
for(const op of operations.filter(op=>op.id!=='event.receive'))for(const audience of op.audiences){
  const definition=schemas.find(item=>item.id===op.input.schemaId).schema;
  api.push({id:`${audience}.${op.id}`,method:op.kind==='command'?'POST':'GET',
    path:`/api/${audience}/granola/${op.id.replaceAll('.','/')}`,operation:ref('operation',op.id),audience,
    auth:['session','oauth','api-token'],parameters:op.kind==='command'?[]:
      Object.entries(definition.properties).filter(([,value])=>['string','integer','boolean'].includes(value.type))
        .map(([name])=>({name,in:'query',inputField:name,required:definition.required.includes(name)})),
    input:op.input,output:op.output,rateLimit:{requests:30,windowSeconds:60}});
}
api.push({id:'webhook.event.receive',method:'POST',path:'/api/webhooks/granola',
  operation:ref('operation','event.receive'),audience:'admin',auth:['webhook-signature'],parameters:[],
  input:eventInput,output:eventOutput,rateLimit:{requests:120,windowSeconds:60}});
const mcpTools=operations.filter(op=>op.id!=='event.receive').map(op=>({id:op.id,name:`granola_${op.id.replaceAll('.','_')}`,
  operation:ref('operation',op.id),audiences:op.audiences,auth:['oauth','api-token'],input:op.input,output:op.output,
  ...(({'note.list':'notes','note.detail':'summary','transcript.page':'transcript','sync.state':'sync'})[op.id]
    ?{widget:ref('widget',({'note.list':'notes','note.detail':'summary',
      'transcript.page':'transcript','sync.state':'sync'})[op.id])}:{}),
  annotations:{readOnly:op.kind==='query',destructive:op.id==='config.key.revoke',
    idempotent:op.kind==='query',openWorld:op.effects.providers.length>0},textFallback:true}));
const widgets=['notes','summary','transcript','sync'].map(kind=>{
  const operationId=({notes:'note.list',summary:'note.detail',transcript:'transcript.page',
    sync:'sync.state'})[kind];
  const source=operations.find(op=>op.id===operationId);
  return {id:kind,version:'1.0.0',compatibility:'^1.0.0',resource:`${kind}-ui`,
    renderer:{path:'ui/widgets/panels.ts',export:'startGranolaWidget'},input:source.output,
    state:empty,result:source.output,audiences:source.audiences,
    permissions:[ref('permission',kind==='sync'?'manage':'read')],requiredCapabilities:[],assets:[],
    actions:[{id:'refresh',label:'Relire',input:source.input,requiredCapabilities:[],
      fallback:'unavailable',mode:'direct',target:{kind:'operation',operation:ref('operation',operationId)}}],
    instance:{identity:'host-generated',revision:'monotonic',correlation:'request-instance-conversation',
      objectVersion:'distinct',lateResponse:'reject-stale'},
    transport:{protocol:'mcp-apps',maxPayloadBytes:65536,timeoutMs:15000,
      uncertainResult:'reconcile-before-retry',fallbackDispatch:'before-first-dispatch-only'}};
});
const widgetResources=widgets.map(widget=>({id:`${widget.id}-ui`,uri:`ui://${id}/${widget.id}`,
  mimeType:'text/html;profile=mcp-app',audiences:widget.audiences,permissions:widget.permissions,
  source:{kind:'asset',path:`ui/widgets/${widget.id}.html`},widget:ref('widget',widget.id),
  ui:{csp:{connectDomains:[],resourceDomains:[],frameDomains:[],baseUriDomains:[]},
    permissions:{},prefersBorder:true}}));
const m=structuredClone(template);
m.identity={id,title:'Granola : notes et transcriptions',publisher:'creezio',
  origin:'https://github.com/creezio/Creezio-D1R2',version,
  source:{kind:'snapshot',revision:sourceRevision,
    integrity:`sha256-${createHash('sha256').update(sourceRevision).digest('hex')}`},
  license:{expression:'NOASSERTION',file:'LICENSE'}};
m.compatibility={core:'^0.0.0',sdk:'^1.6.0',requiredCapabilities:['runtime.worker','data.d1.shared'],optionalCapabilities:[]};
m.entrypoints={server:{path:'module/entry.server.ts',export:'granola'},
  ui:{path:'ui/index.tsx',export:'GranolaNotesView'},
  plugin:{manifest:'plugin/plugin.json',mcp:'plugin/mcp.json',
    contributions:{path:'plugin/contributions.ts',export:'contributions'}}};
m.dependencies=[{moduleId:'creezio.access',origin:m.identity.origin,versionRange:'^0.0.0',optional:false,
  contracts:[],whenAbsent:'block',whenIncompatible:'block',autoInstall:false}];
m.contracts={schemas,models:fields,files:[],events:[],connectors:[structuredClone(granolaConnectorDescriptor)],
  settings:[{id:'api-key-ref',title:'Référence de clé Granola',schema:schema('key-reference-setting',str(128)),
    visibility:'secret-reference',required:false,permissions:[ref('permission','manage')],provider:connectorId,redact:true}],
  search:[],permissions,operations,api,mcp:{tools:mcpTools,resources:widgetResources,prompts:[],skills:[]},
  ui:{views:[
    {id:'notes',title:'Notes Granola',surfaces:['workspace'],route:'/granola/notes',
      component:{path:'ui/index.tsx',export:'GranolaNotesView'},permissions:[ref('permission','read')],
      operations:operations.filter(op=>op.audiences.includes('app')).map(op=>ref('operation',op.id)),input:viewInput,
      panel:{identityFields:[],navigation:'sdk',retention:'preserve',inactiveEffects:'suspend',stateSchema:panelState}},
    {id:'connect',title:'Connexion Granola',surfaces:['workspace'],route:'/admin/granola',
      component:{path:'ui/index.tsx',export:'GranolaConnectView'},permissions:[ref('permission','manage')],
      operations:operations.filter(op=>op.id!=='event.receive'&&op.audiences.includes('admin')).map(op=>ref('operation',op.id)),input:viewInput,
      panel:{identityFields:[],navigation:'sdk',retention:'preserve',inactiveEffects:'suspend',stateSchema:panelState}}],
    navigation:[{id:'granola-notes',title:'Notes Granola',view:ref('view','notes'),permissions:[ref('permission','read')],
      surfaces:['workspace'],order:82},
    {id:'granola-connect',title:'Connexion Granola',view:ref('view','connect'),
      permissions:[ref('permission','manage')],surfaces:['workspace'],order:83}],slots:[],
    front:{mode:'absent',justification:{reason:'Granola notes require authenticated workspace rights.',
      policyRule:'granola.context-only'}},themes:[],styles:[]},widgets,publicContracts:[]};
m.documentation.versionBinding={moduleVersion:version,sourceRevision};
for(const suite of ['backend','ui','api-mcp','widgets','package','docs'])m.validation.suites[suite].tests=[`tests/${suite}/contract.test.mjs`];
m.packaging.runtime.files=['module/manifest.json','module/models.json','module/entry.server.ts','module/storage.ts',
  'module/operations.ts','module/service.ts','module/projection.ts','module/webhook.ts','ui/index.tsx','ui/selection.ts','ui/widgets/panels.ts',
  ...['notes','summary','transcript','sync'].map(name=>`ui/widgets/${name}.html`),
  'README.md','prd.md','CHANGELOG.md','LICENSE','plugin/plugin.json','plugin/mcp.json',
  'plugin/contributions.ts'];
m.packaging.validation.files=['AGENTS.md','FILES.md','interview.md','TODO.md','gate.mjs',
  'module/generate-manifest.mjs','ci/run-suite.mjs','tests/helpers.mjs',
  ...['backend','ui','api-mcp','widgets','package','docs'].flatMap(name=>
    [`ci/${name}.mjs`,`tests/${name}/contract.test.mjs`])];
m.packaging.validationBinding={moduleId:id,moduleVersion:version,sourceRevision};
m.lifecycle.absent={files:{reason:'Bounded notes and transcript pages have no R2 asset.',policyRule:'granola.no-files'}};
m.lifecycle.configuration='explicit-state';
writeFileSync(new URL('module/models.json',root),JSON.stringify(fields,null,2)+'\n');
writeFileSync(new URL('module/manifest.json',root),JSON.stringify(m,null,2)+'\n');
