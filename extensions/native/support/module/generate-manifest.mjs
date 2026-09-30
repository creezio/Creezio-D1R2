import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

const root=new URL('../',import.meta.url);
const m=JSON.parse(readFileSync(new URL('module/manifest.json',root),'utf8'));
const id='creezio.support',revision='t19-support-widgets-v1';
const ref=(kind,name)=>({moduleId:id,kind,id:name});
const S=(max=128,min=1)=>({minLength:min,maxLength:max});
const I=(min=0)=>({minimum:min,maximum:Number.MAX_SAFE_INTEGER});
const field=(name,type,options={})=>({id:name,type,nullable:options.nullable??false,
  protected:options.protected??false,computed:false,...(options.constraints?{constraints:options.constraints}:{})});
const common=[field('context_id','string',{protected:true,constraints:S()}),field('id','string',{constraints:S()}),
  field('created_at','date-time')];
const ticket={id:'ticket',title:'Tickets support',scope:'context',contextField:'context_id',
  fields:[...common,field('requester_id','string',{constraints:S()}),
    field('subject','string',{constraints:S(240)}),field('status','string',{constraints:{enum:['ouvert','repondu','resolu','ferme']}}),
    field('assigned_to','string',{nullable:true,constraints:S()}),
    field('contact_id','string',{nullable:true,constraints:S()}),
    field('message_box_id','string',{nullable:true,constraints:S()}),
    field('message_id','string',{nullable:true,constraints:S()}),field('updated_at','date-time'),
    field('last_message_at','date-time',{nullable:true}),field('last_preview','string',{nullable:true,constraints:S(240,0)}),
    field('message_count','integer',{constraints:I()}),field('revision','integer',{constraints:I(1)})],
  primaryKey:['context_id','id'],indexes:[{id:'recent',fields:['context_id','updated_at','id'],unique:false}],
  relations:[],permissions:[ref('permission','use')],deletion:{mode:'soft',requiresApproval:false},public:false};
const message={id:'message',title:'Messages support',scope:'context',contextField:'context_id',
  fields:[...common,field('ticket_id','string',{constraints:S()}),field('origin','string',{constraints:{enum:['client','support']}}),
    field('author_id','string',{constraints:S()}),field('body','string',{constraints:S(4000)})],
  primaryKey:['context_id','ticket_id','id'],
  indexes:[{id:'by-ticket',fields:['context_id','ticket_id','created_at','id'],unique:false}],
  relations:[{id:'ticket',fields:['context_id','ticket_id'],target:ref('model','ticket'),
    targetFields:['context_id','id'],onDelete:'restrict'}],permissions:[ref('permission','use')],
  deletion:{mode:'hard',requiresApproval:false},public:false};
const obj=(properties,required=Object.keys(properties))=>({type:'object',properties,required,additionalProperties:false});
const str=(max=128,min=1)=>({type:'string',minLength:min,maxLength:max});
const integer=(min=0,max=Number.MAX_SAFE_INTEGER)=>({type:'integer',minimum:min,maximum:max});
const nullable=value=>({anyOf:[value,{type:'null'}]});
const schemas=[],schema=(name,value)=>{schemas.push({id:name,schema:value});return {schemaId:name};};
const ticketView=obj({id:str(),requesterId:str(),subject:str(240),status:{type:'string',enum:['ouvert','repondu','resolu','ferme']},
  assignedTo:nullable(str()),contactId:nullable(str()),messageBoxId:nullable(str()),messageId:nullable(str()),
  createdAt:str(35),updatedAt:str(35),lastMessageAt:nullable(str(35)),
  lastPreview:nullable(str(240,0)),messageCount:integer(),revision:integer(1)});
const messageView=obj({id:str(),ticketId:str(),origin:{type:'string',enum:['client','support']},
  authorId:str(),body:str(4000),createdAt:str(35)});
const ticketOutput=schema('ticket-output',obj({item:ticketView}));
const ticketPage=schema('ticket-page',obj({items:{type:'array',items:ticketView,maxItems:25},nextCursor:nullable(str(2048))}));
const messageOutput=schema('message-output',obj({item:messageView,ticket:ticketView}));
const messagePage=schema('message-page',obj({items:{type:'array',items:messageView,maxItems:50},nextCursor:nullable(str(2048))}));
// Read aliases share one visual card, so either successful readonly output can initialize it.
const listWidgetOutput=schema('support-list-widget-output',{anyOf:[
  schemas.find(item=>item.id==='ticket-page').schema,
  schemas.find(item=>item.id==='ticket-output').schema,
  schemas.find(item=>item.id==='message-page').schema]});
const threadWidgetOutput=schema('support-thread-widget-output',{anyOf:[
  schemas.find(item=>item.id==='ticket-output').schema,
  schemas.find(item=>item.id==='message-page').schema,
  schemas.find(item=>item.id==='message-output').schema]});
const statusOutput=schema('transport-output',obj({state:{type:'string',enum:['unavailable']},externalEmail:{type:'boolean'}}));
const contactReference=obj({id:str(),name:str(240),email:nullable(str(320,0)),companyId:nullable(str())});
const contactReferencePage=schema('reference-contact-page',obj({items:{type:'array',items:contactReference,maxItems:10},
  nextCursor:nullable(str(2048))}));
const contactReferenceOutput=schema('reference-contact-output',obj({item:contactReference}));
const messageReferenceOutput=schema('reference-message-output',obj({message:obj({id:str(),boxId:str(),
  subject:str(240,0),from:str(320,0),text:str(16000,0)})}));
const requestKey=str(),revisionNumber=integer(1),status={type:'string',enum:['ouvert','repondu','resolu','ferme']};
const inputs={
  'ticket.create':schema('ticket-create-input',obj({requestKey,subject:str(240),body:str(4000,0)},['requestKey','subject'])),
  'ticket.list':schema('ticket-list-input',obj({limit:integer(1,25),cursor:str(2048),query:str(120),status},['limit'])),
  'ticket.read':schema('ticket-read-input',obj({id:str()})),
  'ticket.status':schema('ticket-status-input',obj({requestKey,id:str(),revision:revisionNumber,status})),
  'ticket.resolve':schema('ticket-resolve-input',obj({requestKey,id:str(),revision:revisionNumber})),
  'ticket.claim':schema('ticket-claim-input',obj({requestKey,id:str(),revision:revisionNumber,claim:{type:'boolean'}})),
  'message.list':schema('message-list-input',obj({ticketId:str(),limit:integer(1,50),cursor:str(2048)},['ticketId','limit'])),
  'message.customer':schema('message-customer-input',obj({requestKey,ticketId:str(),revision:revisionNumber,body:str(4000)})),
  'message.reply':schema('message-reply-input',obj({requestKey,ticketId:str(),revision:revisionNumber,body:str(4000)})),
  'transport.status':schema('transport-status-input',obj({},[])),
  'reference.contact.search':schema('reference-contact-search-input',obj({ticketId:str(),query:str(120),cursor:str(2048)},['ticketId','query'])),
  'reference.contact.read':schema('reference-contact-read-input',obj({ticketId:str(),contactId:str()})),
  'reference.message.read':schema('reference-message-read-input',obj({ticketId:str(),boxId:str(),messageId:str()})),
  'reference.contact.link':schema('reference-contact-link-input',obj({requestKey,ticketId:str(),revision:revisionNumber,contactId:str()})),
  'reference.contact.unlink':schema('reference-contact-unlink-input',obj({requestKey,ticketId:str(),revision:revisionNumber})),
  'reference.message.link':schema('reference-message-link-input',obj({requestKey,ticketId:str(),revision:revisionNumber,boxId:str(),messageId:str()})),
  'reference.message.unlink':schema('reference-message-unlink-input',obj({requestKey,ticketId:str(),revision:revisionNumber}))};
const permissions=[{id:'use',title:'Utiliser le support',audiences:['admin','app'],
  actors:['user','delegated-user','machine'],scopes:['support.use'],context:'required',default:'deny',
  resources:[ref('model','ticket'),ref('model','message')],actions:['read','create','update','execute'],
  enforcement:{request:true,commit:true},public:false},
  {id:'manage',title:'Gérer la file support',audiences:['admin'],actors:['user','delegated-user','machine'],
    scopes:['support.manage'],context:'required',default:'deny',resources:[ref('model','ticket'),ref('model','message')],
    actions:['read','update','execute'],enforcement:{request:true,commit:true},public:false}];
const errors=['invalid_input','unauthorized','forbidden','not_found','conflict','rate_limited','unavailable','unknown']
  .map(code=>({code,retryable:['rate_limited','unavailable','unknown'].includes(code),outcome:code==='unknown'?'unknown':'rejected'}));
const spec=[
  ['ticket.create','command',['app'],['use'],[],['ticket','message'],ticketOutput],
  ['ticket.list','query',['admin','app'],['use'],['ticket'],[],ticketPage],
  ['ticket.read','query',['admin','app'],['use'],['ticket'],[],ticketOutput],
  ['ticket.status','command',['admin'],['use','manage'],['ticket'],['ticket'],ticketOutput],
  ['ticket.resolve','command',['app'],['use'],['ticket'],['ticket'],ticketOutput],
  ['ticket.claim','command',['admin'],['use','manage'],['ticket'],['ticket'],ticketOutput],
  ['message.list','query',['admin','app'],['use'],['ticket','message'],[],messagePage],
  ['message.customer','command',['app'],['use'],['ticket'],['ticket','message'],messageOutput],
  ['message.reply','command',['admin'],['use','manage'],['ticket'],['ticket','message'],messageOutput],
  ['transport.status','query',['admin','app'],['use'],[],[],statusOutput],
  ['reference.contact.search','query',['admin','app'],['use'],['ticket'],[],contactReferencePage],
  ['reference.contact.read','query',['admin','app'],['use'],['ticket'],[],contactReferenceOutput],
  ['reference.message.read','query',['admin','app'],['use'],['ticket'],[],messageReferenceOutput],
  ['reference.contact.link','command',['admin','app'],['use'],['ticket'],['ticket'],ticketOutput],
  ['reference.contact.unlink','command',['admin','app'],['use'],['ticket'],['ticket'],ticketOutput],
  ['reference.message.link','command',['admin','app'],['use'],['ticket'],['ticket'],ticketOutput],
  ['reference.message.unlink','command',['admin','app'],['use'],['ticket'],['ticket'],ticketOutput]
];
const operations=spec.map(([name,kind,audiences,required,reads,writes,output])=>({
  id:name,title:name,kind,input:inputs[name],output,permissions:required.map(value=>ref('permission',value)),
  audiences,actors:['user','delegated-user','machine'],context:'required',
  handler:{path:'module/operations.ts',export:name.replace(/\.([a-z])/g,(_,letter)=>letter.toUpperCase())},
  effects:{reads:reads.map(value=>ref('model',value)),writes:writes.map(value=>ref('model',value)),
    emits:[],calls:name==='reference.contact.search'?[{moduleId:'creezio.crm',kind:'operation',id:'contact.search'}]:
      ['reference.contact.read','reference.contact.link'].includes(name)?[{moduleId:'creezio.crm',kind:'operation',id:'contact.read'}]:
      ['reference.message.read','reference.message.link'].includes(name)?[{moduleId:'creezio.messaging',kind:'operation',id:'message.read'}]:[],providers:[]},errors,
  pagination:['ticket.list','message.list'].includes(name)?{mode:'cursor',cursorField:'cursor',limitField:'limit',maxItems:name==='ticket.list'?25:50}:{mode:'none'},
  idempotency:kind==='command'?{mode:'required',keyField:'requestKey',scope:'actor-context-operation',retentionSeconds:86400}:{mode:'none'},
  approval:{mode:'none'},concurrency:{mode:'none'},
  execution:{maxDurationMs:10000,maxItems:name==='ticket.list'?500:name==='message.list'?51:10,resumable:false},
  audit:{required:true,redactFields:['body','query']},public:false,
  ...(name.startsWith('reference.contact.')&&!name.endsWith('.unlink')?{requiresModules:['creezio.crm']}:
    name.startsWith('reference.message.')&&!name.endsWith('.unlink')?{requiresModules:['creezio.messaging']}:{})}));
const api=[],tools=[];
const widgetForTool={'ticket.list':'ticket-list-app','ticket.read':'ticket-thread-app',
  'ticket.create':'ticket-list-app','message.list':'ticket-thread-app',
  'message.customer':'ticket-thread-app','message.reply':'ticket-thread-admin'};
for(const op of operations){const command=op.kind==='command';
  for(const audience of op.audiences){const input=schemas.find(item=>item.id===op.input.schemaId).schema;
    api.push({id:`${audience}.${op.id}`,method:command?'POST':'GET',path:`/api/${audience}/support/${op.id.replaceAll('.','/')}`,
      operation:ref('operation',op.id),audience,auth:['session','oauth','api-token'],
      parameters:command?[]:Object.keys(input.properties).map(name=>({name:name.replace(/[A-Z]/g,letter=>`-${letter.toLowerCase()}`),in:'query',inputField:name,
        required:input.required.includes(name)})),input:op.input,output:op.output,rateLimit:{requests:60,windowSeconds:60},
      ...(op.requiresModules?{requiresModules:op.requiresModules}:{})});}
  tools.push({id:op.id,name:`support_${op.id.replaceAll('.','_')}`,operation:ref('operation',op.id),
    audiences:widgetForTool[op.id]&&op.audiences.length===2?['app']:op.audiences,
    auth:['oauth','api-token'],input:op.input,output:op.output,
    annotations:{readOnly:!command,destructive:false,idempotent:!command,openWorld:false},
    ...(widgetForTool[op.id]?{widget:ref('widget',widgetForTool[op.id])}:{}),textFallback:true,
    ...(op.requiresModules?{requiresModules:op.requiresModules}:{})});}
// Read aliases expose the same three operations to the other audience's renderer.
for(const [alias,operation,widget,audience] of [
  ['ticket.list.admin','ticket.list','ticket-list-admin','admin'],
  ['ticket.read.admin','ticket.read','ticket-thread-admin','admin'],
  ['message.list.admin','message.list','ticket-thread-admin','admin'],
  ['ticket.open.app','ticket.read','ticket-list-app','app'],
  ['ticket.open.admin','ticket.read','ticket-list-admin','admin'],
  ['message.list.app.list','message.list','ticket-list-app','app'],
  ['message.list.admin.list','message.list','ticket-list-admin','admin']]){
  tools.push({id:alias,name:`support_${alias.replaceAll('.','_')}`,
    operation:ref('operation',operation),audiences:[audience],auth:['oauth','api-token'],
    input:inputs[operation],output:operations.find(item=>item.id===operation).output,
    annotations:{readOnly:true,destructive:false,idempotent:true,openWorld:false},
    widget:ref('widget',widget),textFallback:true});
}
const skillPath='plugin/skills/support.md';
const skillIntegrity=`sha256-${createHash('sha256').update(readFileSync(new URL(skillPath,root))).digest('hex')}`;
const widgetState=schema('support-widget-state',obj({ticketId:str(),cursor:str(2048),query:str(120)},[]));
const widgetResource=(name,audience)=>({id:`${name}-ui`,uri:`ui://${id}/${name}`,
  mimeType:'text/html;profile=mcp-app',audiences:[audience],permissions:[ref('permission','use')],
  source:{kind:'asset',path:`ui/widgets/${name.split('-')[1]}.html`},widget:ref('widget',name),
  ui:{csp:{connectDomains:[],resourceDomains:[],frameDomains:[],baseUriDomains:[]},
    permissions:{},prefersBorder:true}});
const widgetAction=(name,label,operation)=>({id:name,label,input:inputs[operation],
  requiredCapabilities:[],fallback:'unavailable',mode:'direct',
  target:{kind:'operation',operation:ref('operation',operation)}});
const widget=(kind,audience)=>{
  const list=kind==='list',name=`ticket-${kind}-${audience}`;
  const actions=list?[widgetAction('list','Actualiser','ticket.list'),
    widgetAction('open','Ouvrir','ticket.read'),
    widgetAction('messages','Lire le fil','message.list'),
    ...(audience==='app'?[widgetAction('create','Créer un ticket','ticket.create')]:[])]:
    [widgetAction('read','Actualiser le ticket','ticket.read'),
      widgetAction('messages','Lire le fil','message.list'),
      widgetAction('send','Enregistrer une réponse',audience==='app'?'message.customer':'message.reply')];
  return {id:name,version:'1.0.0',compatibility:'^1.0.0',resource:`${name}-ui`,
    renderer:{path:`ui/widgets/${name}.ts`,export:`start${audience==='app'?'App':'Admin'}${list?'List':'Thread'}`},
    input:list?listWidgetOutput:threadWidgetOutput,state:widgetState,
    result:list?listWidgetOutput:threadWidgetOutput,
    audiences:[audience],permissions:[ref('permission','use')],requiredCapabilities:[],assets:[],actions,
    instance:{identity:'host-generated',revision:'monotonic',correlation:'request-instance-conversation',
      objectVersion:'distinct',lateResponse:'reject-stale'},
    transport:{protocol:'mcp-apps',maxPayloadBytes:786432,timeoutMs:15000,
      uncertainResult:'reconcile-before-retry',fallbackDispatch:'before-first-dispatch-only'}};
};
const widgets=[widget('list','app'),widget('list','admin'),widget('thread','app'),widget('thread','admin')];
m.identity={id,title:'Support natif',publisher:'creezio',origin:'https://github.com/creezio/Creezio-D1R2',
  version:'0.0.0',source:{kind:'snapshot',revision,integrity:`sha256-${createHash('sha256').update(revision).digest('hex')}`},
  license:{expression:'NOASSERTION',file:'LICENSE'}};
m.compatibility={core:'^0.0.0',sdk:'^1.6.0',requiredCapabilities:['runtime.worker','data.d1.shared'],optionalCapabilities:[]};
m.entrypoints={server:{path:'module/entry.server.ts',export:'support'},ui:{path:'ui/index.tsx',export:'SupportWorkspaceView'},
  plugin:{manifest:'plugin/plugin.json',mcp:'plugin/mcp.json',contributions:{path:'plugin/contributions.ts',export:'contributions'}}};
m.dependencies=[{moduleId:'creezio.access',origin:m.identity.origin,versionRange:'^0.0.0',optional:false,
  contracts:[],whenAbsent:'block',whenIncompatible:'block',autoInstall:false},
  {moduleId:'creezio.crm',origin:m.identity.origin,versionRange:'^0.0.0',optional:true,
    contracts:[{id:'contact-lookup',versionRange:'^1.0.0'}],whenAbsent:'disable-contributions',
    whenIncompatible:'block',autoInstall:false},
  {moduleId:'creezio.messaging',origin:m.identity.origin,versionRange:'^0.0.0',optional:true,
    contracts:[{id:'message-lookup',versionRange:'^1.0.0'}],whenAbsent:'disable-contributions',
    whenIncompatible:'block',autoInstall:false}];
const viewInput=schema('support-view-input',obj({},[]));
const pendingState=obj({sessionId:str(),audience:{type:'string',enum:['admin','app']},contextId:str(),
  bindingId:str(257),requestKey:str(512),intent:str(64),targetId:str()},
  ['sessionId','audience','contextId','bindingId','requestKey']);
const panelState=schema('support-panel-state',obj({sessionId:str(),audience:{type:'string',enum:['admin','app']},
  contextId:str(),ticketId:str(),pending:pendingState},[]));
m.contracts={schemas,models:[ticket,message],files:[],events:[],settings:[],search:[],permissions,operations,api,
  mcp:{tools,resources:widgets.map(item=>widgetResource(item.id,item.audiences[0])),prompts:[],
    skills:[{id:'support',path:skillPath,audiences:['admin','app'],
      operations:['ticket.list','ticket.read','ticket.create','message.list','message.customer','message.reply']
        .map(name=>ref('operation',name)),resources:widgets.map(item=>`${item.id}-ui`),integrity:skillIntegrity}]},
  ui:{views:[{id:'workspace',title:'Support',surfaces:['workspace'],
    route:'/admin/support',component:{path:'ui/index.tsx',export:'SupportWorkspaceView'},permissions:[ref('permission','use')],
    operations:operations.filter(op=>!op.requiresModules).map(op=>ref('operation',op.id)),input:viewInput,
    panel:{identityFields:[],navigation:'sdk',retention:'preserve',inactiveEffects:'suspend',stateSchema:panelState}},
    {id:'front',title:'Support',surfaces:['front'],route:'/support',
      component:{path:'ui/index.tsx',export:'SupportWorkspaceView'},permissions:[ref('permission','use')],
      operations:operations.filter(op=>op.audiences.includes('app')&&!op.requiresModules).map(op=>ref('operation',op.id)),input:viewInput,
      panel:{identityFields:[],navigation:'sdk',retention:'preserve',inactiveEffects:'suspend',stateSchema:panelState}}],
    navigation:[{id:'support',title:'Support',view:ref('view','workspace'),permissions:[ref('permission','use')],
      surfaces:['workspace'],order:60},
      {id:'support-front',title:'Support',view:ref('view','front'),permissions:[ref('permission','use')],
        surfaces:['front'],order:60}],slots:[],front:{mode:'provided'},
      themes:[],styles:[]},widgets,publicContracts:[]};
m.documentation.versionBinding={moduleVersion:'0.0.0',sourceRevision:revision};
for(const name of ['backend','ui','api-mcp','widgets','package','docs'])m.validation.suites[name].tests=[`tests/${name}/contract.test.mjs`];
m.validation.suites.widgets.mode='not-applicable';
delete m.validation.suites.widgets.justification;
m.validation.suites.widgets.mode='required';
m.validation.suites.widgets.tests.push('tests/widgets/runtime.test.mjs');
m.packaging.runtime.files=['module/manifest.json','module/models.json','module/entry.server.ts','module/operations.ts',
  'module/service.ts','ui/index.tsx','ui/state.ts','README.md','prd.md','CHANGELOG.md','LICENSE',
  'ui/widgets/runtime.ts','ui/widgets/list.html','ui/widgets/thread.html',
  ...widgets.map(item=>`ui/widgets/${item.id}.ts`),
  'plugin/plugin.json','plugin/mcp.json','plugin/contributions.ts',skillPath];
m.packaging.validation.files=['AGENTS.md','FILES.md','interview.md','TODO.md','gate.mjs','module/generate-manifest.mjs',
  'ci/run-suite.mjs','tests/helpers.mjs',...['backend','ui','api-mcp','widgets','package','docs'].flatMap(name=>
    [`ci/${name}.mjs`,`tests/${name}/contract.test.mjs`]),'tests/widgets/runtime.test.mjs'];
m.packaging.validationBinding={moduleId:id,moduleVersion:'0.0.0',sourceRevision:revision};
m.lifecycle.absent={files:{reason:'Support v1 has no attachment category.',policyRule:'support.no-files'}};
m.lifecycle.configuration='explicit-state';
writeFileSync(new URL('module/models.json',root),JSON.stringify([ticket,message],null,2)+'\n');
writeFileSync(new URL('module/manifest.json',root),JSON.stringify(m,null,2)+'\n');
