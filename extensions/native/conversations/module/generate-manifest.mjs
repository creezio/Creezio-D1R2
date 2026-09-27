import {readFileSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const here = new URL('../', import.meta.url);
const template = JSON.parse(readFileSync(new URL('module/manifest.json', here), 'utf8'));
const id = 'creezio.conversations';
const ref = (kind, name) => ({moduleId:id,kind,id:name});
const field = (name,type,options={}) => ({id:name,type,nullable:options.nullable??false,protected:options.protected??false,
  computed:false,...(options.default===undefined?{}:{default:options.default}),
  ...(options.constraints?{constraints:options.constraints}:{})});
const S = (max=128,min=1) => ({minLength:min,maxLength:max});
const I = (min=0) => ({minimum:min,maximum:Number.MAX_SAFE_INTEGER});
const scope = [field('contextId','string',{constraints:S(128)}),field('ownerId','string',{constraints:S(128)}),
  field('audience','string',{constraints:{enum:['admin','app']}})];
const common = ['contextId','ownerId','audience'];
const relation = (name,source) => ({id:name,fields:[...common,source],target:ref('model','conversation'),
  targetFields:[...common,'id'],onDelete:'restrict'});
const model = (name,title,fields,primaryKey,indexes=[],relations=[]) => ({id:name,title,scope:'context',contextField:'contextId',
  fields:[...scope,...fields],primaryKey,indexes,relations,permissions:[ref('permission','use')],
  deletion:{mode:'soft',requiresApproval:false},public:false});
const models = [
  model('conversation','Conversations',[
    field('id','string',{constraints:S(128)}),field('title','string',{constraints:S(240)}),
    field('mode','string',{constraints:{enum:['chat','work']}}),field('createdAt','date-time'),
    field('updatedAt','date-time'),field('archivedAt','date-time',{nullable:true}),
    field('activeTurnId','string',{nullable:true,constraints:S(128)}),field('revision','integer',{constraints:I(1)})],
    [...common,'id'],[{id:'recent',fields:[...common,'updatedAt','id'],unique:false}]),
  model('message','Messages',[
    field('conversationId','string',{constraints:S(128)}),field('id','string',{constraints:S(128)}),
    field('role','string',{constraints:{enum:['user','assistant','tool','system']}}),
    field('body','string',{constraints:S(16000,0)}),field('content','json',{nullable:true}),
    field('createdAt','date-time'),field('revision','integer',{constraints:I(1)})],
    [...common,'conversationId','id'],[{id:'chronology',fields:[...common,'conversationId','createdAt','id'],unique:false},
      {id:'search-chronology',fields:[...common,'createdAt','conversationId','id'],unique:false}],
    [relation('conversation','conversationId')]),
  model('draft','Brouillons',[
    field('conversationId','string',{constraints:S(128)}),field('text','string',{constraints:S(16000,0)}),
    field('updatedAt','date-time'),field('revision','integer',{constraints:I(1)})],
    [...common,'conversationId'],[],[relation('conversation','conversationId')]),
  model('turn','Tours de conversation',[
    field('conversationId','string',{constraints:S(128)}),field('id','string',{constraints:S(128)}),
    field('state','string',{constraints:{enum:['queued','running','succeeded','failed','cancel_requested','cancelled','no_provider','unknown']}}),
    field('providerId','string',{nullable:true,constraints:S(128)}),field('createdAt','date-time'),
    field('updatedAt','date-time'),field('revision','integer',{constraints:I(1)}),
    field('lastSequence','integer',{constraints:I(0)}),field('errorCode','string',{nullable:true,constraints:S(128)})],
    [...common,'conversationId','id'],[{id:'recent-turns',fields:[...common,'conversationId','createdAt','id'],unique:false}],
    [relation('conversation','conversationId')]),
  model('event','Événements de progression',[
    field('conversationId','string',{constraints:S(128)}),field('turnId','string',{constraints:S(128)}),
    field('sequence','integer',{constraints:I(1)}),field('kind','string',{constraints:S(64)}),
    field('payload','json'),field('createdAt','date-time')],
    [...common,'conversationId','turnId','sequence'],[{id:'by-turn',fields:[...common,'conversationId','turnId','sequence'],unique:true}],
    [relation('conversation','conversationId'),{id:'turn',fields:[...common,'conversationId','turnId'],
      target:ref('model','turn'),targetFields:[...common,'conversationId','id'],onDelete:'restrict'}]),
  model('file_metadata','Private file metadata',[
    field('fileId','string',{protected:true,constraints:S(67)}),field('fileOwner','string',{protected:true,constraints:S(260)}),
    field('objectKey','string',{protected:true,constraints:S(512)}),
    field('digest','string',{protected:true,constraints:{minLength:64,maxLength:64}}),
    field('byteSize','integer',{protected:true,constraints:I(0)}),field('contentType','string',{protected:true,constraints:S(128)}),
    field('filename','string',{protected:true,constraints:S(255)}),field('version','integer',{protected:true,constraints:I(1)}),
    field('state','string',{protected:true,constraints:{enum:['staging','staged','available','abandoned','deleted']}}),
    field('intentId','string',{protected:true,constraints:S(128)}),field('generation','string',{protected:true,constraints:S(128)})],
    ['contextId','fileId'],[{id:'intent',fields:['contextId','intentId','generation'],unique:true},
      {id:'object-key',fields:['contextId','objectKey'],unique:true}]),
  model('conversation_attachment','Pièces jointes des conversations',[
    field('conversationId','string',{constraints:S(128)}),field('fileId','string',{constraints:S(67)}),
    field('filename','string',{constraints:S(255)}),field('contentType','string',{constraints:S(128)}),
    field('byteSize','integer',{constraints:I(0)}),field('digest','string',{constraints:{minLength:64,maxLength:64}}),
    field('intentId','string',{constraints:S(128)}),field('generation','string',{constraints:S(128)}),
    field('createdAt','date-time')],
    [...common,'conversationId','fileId'],[{id:'by-conversation',fields:[...common,'conversationId','createdAt','fileId'],unique:false}],
    [relation('conversation','conversationId')])
];
// The file service owns all metadata columns, including the context and owner.
for(const name of ['contextId',...Object.values({id:'fileId',objectKey:'objectKey',digest:'digest',byteSize:'byteSize',
  contentType:'contentType',filename:'filename',version:'version',state:'state',intentId:'intentId',generation:'generation'})])
  models.find(m=>m.id==='file_metadata').fields.find(f=>f.id===name).protected=true;
models.find(m=>m.id==='file_metadata').fields=models.find(m=>m.id==='file_metadata').fields
  .filter(f=>!['ownerId','audience'].includes(f.id));
const snake = name => name.replaceAll(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
for (const item of models) {
  item.contextField = snake(item.contextField);
  for (const value of item.fields) value.id = snake(value.id);
  item.primaryKey = item.primaryKey.map(snake);
  for (const index of item.indexes) index.fields = index.fields.map(snake);
  for (const link of item.relations) {
    link.fields = link.fields.map(snake);
    link.targetFields = link.targetFields.map(snake);
  }
}

const obj = (properties,required=Object.keys(properties)) => ({type:'object',properties,required,additionalProperties:false});
const str = (max=128,min=1) => ({type:'string',minLength:min,maxLength:max});
const num = (min=0,max=Number.MAX_SAFE_INTEGER) => ({type:'integer',minimum:min,maximum:max});
const nullable = schema => ({anyOf:[schema,{type:'null'}]});
const summary = obj({id:str(),title:str(240),mode:{type:'string',enum:['chat','work']},
  updatedAt:str(35),archivedAt:nullable(str(35)),revision:num(1)});
const message = obj({id:str(),conversationId:str(),role:{type:'string',enum:['user','assistant','tool','system']},
  body:str(16000,0),createdAt:str(35),revision:num(1)});
const turn = obj({id:str(),conversationId:str(),state:{type:'string',enum:['queued','running','succeeded','failed','cancel_requested','cancelled','no_provider','unknown']},
  providerId:nullable(str()),updatedAt:str(35),revision:num(1),lastSequence:num(0),errorCode:nullable(str())});
const event = obj({turnId:str(),sequence:num(1),kind:str(64),payload:{},createdAt:str(35)});
const page = item => obj({items:{type:'array',items:item,maxItems:50},nextCursor:nullable(str(2048))});
const schemas = [];
const schema = (name,value) => {schemas.push({id:name,schema:value});return {schemaId:name};};
const empty = schema('empty-input',obj({}));
const idInput = schema('conversation-id-input',obj({conversationId:str()}));
const listInput = schema('conversation-list-input',obj({limit:num(1,50),cursor:str(2048),archived:{type:'boolean'}},['limit']));
const searchInput = schema('conversation-search-input',obj({limit:num(1,50),cursor:str(2048),query:str(240,1),archived:{type:'boolean'}},['limit','query']));
const summaryPage = schema('conversation-page-output',page(summary));
const createInput = schema('conversation-create-input',obj({requestKey:str(128),mode:{type:'string',enum:['chat','work']},title:str(240)},['requestKey','mode']));
const summaryOut = schema('conversation-summary-output',obj({conversation:summary}));
const readOutput = schema('conversation-read-output',obj({conversation:summary,provider:{type:'string',enum:['no_provider','configured']}}));
const renameInput = schema('conversation-rename-input',obj({requestKey:str(128),conversationId:str(),title:str(240),revision:num(1)}));
const stateInput = schema('conversation-state-input',obj({requestKey:str(128),conversationId:str(),revision:num(1)}));
const messagesInput = schema('message-list-input',obj({conversationId:str(),limit:num(1,50),cursor:str(2048)},['conversationId','limit']));
const messagesOutput = schema('message-page-output',page(message));
const addMessageInput = schema('message-add-input',obj({requestKey:str(128),conversationId:str(),id:str(),body:str(16000),revision:num(1)}));
const messageOutput = schema('message-output',obj({message}));
const draftInput = schema('draft-read-input',obj({conversationId:str()}));
const draftOutput = schema('draft-output',obj({conversationId:str(),text:str(16000,0),updatedAt:nullable(str(35)),revision:num(0)}));
const draftSaveInput = schema('draft-save-input',obj({requestKey:str(128),conversationId:str(),text:str(16000,0),revision:num(0)}));
const turnInput = schema('turn-read-input',obj({conversationId:str(),turnId:str()}));
const turnOutput = schema('turn-output',obj({turn:nullable(turn)}));
const eventInput = schema('event-list-input',obj({conversationId:str(),turnId:str(),limit:num(1,50),afterSequence:num(0)},['conversationId','turnId','limit']));
const eventOutput = schema('event-page-output',obj({items:{type:'array',items:event,maxItems:50},nextSequence:nullable(num(1))}));
const cancelInput = schema('turn-cancel-input',obj({requestKey:str(128),conversationId:str(),turnId:str(),revision:num(1)}));
const startInput = schema('turn-start-input',obj({requestKey:str(128),conversationId:str(),messageId:str(),
  body:str(16000),revision:num(1),draftRevision:num(0),modelId:str(128)}));
const startOutput = schema('turn-start-output',obj({message,turn}));
const attachInput = schema('attachment-link-input',obj({requestKey:str(128),conversationId:str(),revision:num(1),
  staged:obj({fileId:str(67),intentId:str(),generation:str(),digest:str(64)})}));
const attachOutput = schema('attachment-link-output',obj({fileId:str(67),conversationId:str()}));
const attachment = obj({fileId:str(67),conversationId:str(),filename:str(255),contentType:str(128),
  byteSize:num(0),createdAt:str(35),reference:obj({fileId:str(67),intentId:str(),generation:str(),digest:str(64)})});
const attachListInput = schema('attachment-list-input',obj({conversationId:str(),limit:num(1,50),cursor:str(2048)},['conversationId','limit']));
const attachListOutput = schema('attachment-page-output',page(attachment));
const viewInput = schema('conversation-view-input',obj({conversationId:str(),presentation:{type:'string',enum:['assistant','page']}},[]));
const panelState = schema('conversation-panel-state',obj({conversationId:str(),draft:str(16000,0)},[]));

const permission = {id:'use',title:'Utiliser ses conversations',audiences:['admin','app'],
  actors:['user','delegated-user'],scopes:['conversations.use'],context:'required',default:'deny',
  resources:[...models.map(m=>ref('model',m.id)),ref('file','attachments')],
  actions:['read','create','update','delete','execute'],enforcement:{request:true,commit:true},public:false};
const errors = ['invalid_input','unauthorized','forbidden','not_found','conflict','rate_limited','unavailable','unknown']
  .map(code=>({code,retryable:['rate_limited','unavailable','unknown'].includes(code),outcome:code==='unknown'?'unknown':'rejected'}));
const operations = [];
function operation(name,title,kind,input,output,reads=[],writes=[],options={}) {
  const command=kind==='command';
  operations.push({id:name,title,kind,input,output,permissions:[ref('permission','use')],audiences:['admin','app'],
    actors:['user','delegated-user'],context:'required',handler:{path:'module/operations.ts',export:options.exportName??name.replaceAll(/(^|[.-])([a-z])/g,(_m,_p,c)=>c.toUpperCase()).replace(/^./,c=>c.toLowerCase())},
    effects:{reads:reads.map(m=>ref('model',m)),writes:writes.map(m=>ref('model',m)),emits:[],calls:[],providers:[]},
    errors,pagination:options.pagination??{mode:'none'},idempotency:command?{mode:'required',keyField:'requestKey',scope:'actor-context-operation',retentionSeconds:86400}:{mode:'none'},
    approval:{mode:'none'},concurrency:options.concurrency??{mode:'none'},
    execution:{maxDurationMs:10000,maxItems:options.maxItems??100,resumable:false},
    audit:{required:true,redactFields:['body','text','query']},public:false});
}
operation('conversation.list','Lister les conversations','query',listInput,summaryPage,['conversation'],[],{exportName:'conversationList',maxItems:50,pagination:{mode:'cursor',cursorField:'cursor',limitField:'limit',maxItems:50}});
operation('conversation.search','Chercher les conversations','query',searchInput,summaryPage,['conversation','message'],[],{exportName:'conversationSearch',maxItems:50,pagination:{mode:'cursor',cursorField:'cursor',limitField:'limit',maxItems:50}});
operation('conversation.create','Créer une conversation','command',createInput,summaryOut,[],['conversation'],{exportName:'conversationCreate'});
operation('conversation.read','Lire une conversation','query',idInput,readOutput,['conversation'],[],{exportName:'conversationRead'});
operations.find(op=>op.id==='conversation.read').effects.providers.push('openai.responses.v1');
operation('conversation.rename','Renommer une conversation','command',renameInput,summaryOut,['conversation'],['conversation'],{exportName:'conversationRename',concurrency:{mode:'object-version',versionField:'revision'}});
operation('conversation.archive','Archiver une conversation','command',stateInput,summaryOut,['conversation'],['conversation'],{exportName:'conversationArchive',concurrency:{mode:'object-version',versionField:'revision'}});
operation('conversation.restore','Restaurer une conversation','command',stateInput,summaryOut,['conversation'],['conversation'],{exportName:'conversationRestore',concurrency:{mode:'object-version',versionField:'revision'}});
operation('message.list','Lister les messages','query',messagesInput,messagesOutput,['conversation','message'],[],{exportName:'messageList',maxItems:50,pagination:{mode:'cursor',cursorField:'cursor',limitField:'limit',maxItems:50}});
operation('message.add','Ajouter un message utilisateur','command',addMessageInput,messageOutput,['conversation'],['conversation','message'],{exportName:'messageAdd',concurrency:{mode:'object-version',versionField:'revision'}});
operation('draft.read','Lire un brouillon','query',draftInput,draftOutput,['conversation','draft'],[],{exportName:'draftRead'});
operation('draft.save','Enregistrer un brouillon','command',draftSaveInput,draftOutput,['conversation','draft'],['draft'],{exportName:'draftSave'});
operation('turn.read','Lire le statut d’un tour','query',turnInput,turnOutput,['conversation','turn'],[],{exportName:'turnRead'});
operation('turn.start','Démarrer un tour IA','command',startInput,startOutput,['conversation','draft'],
  ['conversation','message','draft','turn','event'],{exportName:'turnStart',concurrency:{mode:'object-version',versionField:'revision'}});
operations.find(op=>op.id==='turn.start').effects.providers.push('openai.responses.v1');
operation('event.list','Lire la progression','query',eventInput,eventOutput,['conversation','turn','event'],[],{exportName:'eventList',maxItems:52,pagination:{mode:'cursor',cursorField:'afterSequence',limitField:'limit',maxItems:50}});
operation('turn.cancel','Demander l’annulation d’un tour','command',cancelInput,turnOutput,['conversation','turn'],['turn','event'],{exportName:'turnCancel',concurrency:{mode:'object-version',versionField:'revision'}});
operation('attachment.link','Lier une pièce jointe','command',attachInput,attachOutput,['conversation'],['conversation','conversation_attachment'],{exportName:'attachmentLink',concurrency:{mode:'object-version',versionField:'revision'}});
operations.find(op=>op.id==='attachment.link').effects.writes.push(ref('file','attachments'));
operation('attachment.list','Lister les pièces jointes','query',attachListInput,attachListOutput,['conversation','conversation_attachment'],[],
  {exportName:'attachmentList',maxItems:51,pagination:{mode:'cursor',cursorField:'cursor',limitField:'limit',maxItems:50}});

const category = {id:'attachments',metadataModel:ref('model','file_metadata'),contextField:'context_id',ownerField:'file_owner',
  storageFields:{id:'file_id',objectKey:'object_key',digest:'digest',byteSize:'byte_size',contentType:'content_type',
    filename:'filename',version:'version',state:'state',intentId:'intent_id',generation:'generation'},
  mimeTypes:['text/plain','application/pdf','image/png','image/jpeg'],maxBytes:10*1024*1024,public:false,permissions:[ref('permission','use')],
  attachment:{models:[ref('model','conversation')],multiple:true},deletion:'restrict'};

const api=[];
for(const audience of ['admin','app']) for(const op of operations) {
  const suffix=op.id.replaceAll('.','/');
  const command=op.kind==='command';
  const parameters=[];
  if(!command) {
    const properties=schemas.find(s=>s.id===op.input.schemaId).schema.properties;
    for(const key of Object.keys(properties)) if(key!=='cursor'&&key!=='afterSequence'&&key!=='archived'&&key!=='query'&&key!=='limit'&&key!=='conversationId'&&key!=='turnId') continue;
    for(const key of Object.keys(properties)) {
      if(properties[key].type==='string' || properties[key].type==='integer' || properties[key].type==='boolean')
        parameters.push({name:key.replaceAll(/[A-Z]/g,c=>'_'+c.toLowerCase()),in:'query',inputField:key,
          required:schemas.find(s=>s.id===op.input.schemaId).schema.required.includes(key)});
    }
  }
  api.push({id:`${audience}.${op.id}`,method:command?'POST':'GET',path:`/api/${audience}/conversations/${suffix}`,
    operation:ref('operation',op.id),audience,auth:['session','oauth'],parameters,input:op.input,output:op.output,
    rateLimit:{requests:60,windowSeconds:60}});
}

const m=structuredClone(template);
m.identity={id,title:'Conversations natives',publisher:'creezio',origin:'https://github.com/creezio/Creezio-D1R2',
  version:'0.0.0',source:{kind:'snapshot',revision:'t14-conversations-v1',integrity:`sha256-${createHash('sha256').update('t14-conversations-v1').digest('hex')}`},
  license:{expression:'NOASSERTION',file:'LICENSE'}};
m.compatibility={core:'^0.0.0',sdk:'^1.0.0',requiredCapabilities:['runtime.worker','data.d1.shared'],optionalCapabilities:['files.r2.private']};
m.entrypoints={server:{path:'module/entry.server.ts',export:'conversations'},ui:{path:'ui/index.tsx',export:'ConversationsAdminView'},
  plugin:{manifest:'plugin/plugin.json',mcp:'plugin/mcp.json',contributions:{path:'plugin/contributions.ts',export:'contributions'}}};
m.dependencies=[{moduleId:'creezio.access',origin:'https://github.com/creezio/Creezio-D1R2',versionRange:'^0.0.0',optional:false,
  contracts:[],whenAbsent:'block',whenIncompatible:'block',autoInstall:false}];
const mcpTools=operations.map(op=>({id:op.id,name:`conversations_${op.id.replaceAll('.','_')}`,
  operation:ref('operation',op.id),audiences:['admin','app'],auth:['oauth'],input:op.input,output:op.output,
  annotations:{readOnly:op.kind==='query',destructive:false,idempotent:op.kind==='query',openWorld:false},textFallback:true}));
m.contracts={schemas,models,files:[category],events:[],settings:[],search:[],permissions:[permission],operations,api,
  mcp:{tools:mcpTools,resources:[],prompts:[],skills:[]},
  ui:{views:[
    {id:'admin',title:'Conversations',surfaces:['workspace'],route:'/admin/conversations',
      component:{path:'ui/index.tsx',export:'ConversationsAdminView'},permissions:[ref('permission','use')],operations:operations.map(op=>ref('operation',op.id)),
      input:viewInput,panel:{identityFields:[],navigation:'sdk',retention:'preserve',inactiveEffects:'suspend',stateSchema:panelState}},
    {id:'front',title:'Conversations',surfaces:['front'],route:'/conversations',
      component:{path:'ui/index.tsx',export:'ConversationsFrontView'},permissions:[ref('permission','use')],operations:operations.map(op=>ref('operation',op.id)),
      input:viewInput,panel:{identityFields:[],navigation:'sdk',retention:'preserve',inactiveEffects:'suspend',stateSchema:panelState}}
  ],navigation:[
    {id:'conversations-admin',title:'Conversations',view:ref('view','admin'),permissions:[ref('permission','use')],surfaces:['workspace'],order:20},
    {id:'conversations-front',title:'Conversations',view:ref('view','front'),permissions:[ref('permission','use')],surfaces:['front'],order:20}
  ],slots:[],front:{mode:'provided'},themes:[],styles:[]},widgets:[],publicContracts:[]};
m.documentation.versionBinding={moduleVersion:'0.0.0',sourceRevision:'t14-conversations-v1'};
m.validation.suites.backend.tests=['tests/backend/contract.test.mjs'];
m.validation.suites.ui.tests=['tests/ui/contract.test.mjs'];
m.validation.suites['api-mcp'].tests=['tests/api-mcp/contract.test.mjs'];
m.validation.suites.widgets.tests=['tests/widgets/contract.test.mjs'];
m.validation.suites.widgets.justification={reason:'Conversation widgets and GPT bridge follow in T16.',policyRule:'conversations.widgets-t16'};
m.validation.suites.package.tests=['tests/package/contract.test.mjs'];
m.validation.suites.docs.tests=['tests/docs/contract.test.mjs'];
m.packaging.runtime.files=['module/manifest.json','module/models.json','module/entry.server.ts','module/operations.ts','module/service.ts',
  'ui/index.tsx','ui/panel.tsx','ui/turn-projection.ts','ui/drive-loop.ts','ui/message-content.tsx','ui/entity-links.ts','ui/source-links.ts',
  'README.md','prd.md','CHANGELOG.md','LICENSE','plugin/plugin.json','plugin/mcp.json','plugin/contributions.ts'];
m.packaging.validation.files=['AGENTS.md','FILES.md','interview.md','TODO.md','gate.mjs','module/generate-manifest.mjs','ci/run-suite.mjs','tests/helpers.mjs',
  ...['backend','ui','api-mcp','widgets','package','docs'].flatMap(name=>[`ci/${name}.mjs`,`tests/${name}/contract.test.mjs`])];
m.packaging.validationBinding={moduleId:id,moduleVersion:'0.0.0',sourceRevision:'t14-conversations-v1'};
m.lifecycle.absent={widgets:{reason:'Conversation widgets and GPT bridge follow in T16.',policyRule:'conversations.widgets-t16'}};
m.lifecycle.configuration='explicit-state';
writeFileSync(new URL('module/models.json',here),JSON.stringify(models,null,2)+'\n');
writeFileSync(new URL('module/manifest.json',here),JSON.stringify(m,null,2)+'\n');
