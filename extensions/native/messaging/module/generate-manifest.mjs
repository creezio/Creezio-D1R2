import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

const root=new URL('../',import.meta.url);
const template=JSON.parse(readFileSync(new URL('../conversations/module/manifest.json',root),'utf8'));
const id='creezio.messaging',ref=(kind,name)=>({moduleId:id,kind,id:name});
const S=(max=128,min=1)=>({minLength:min,maxLength:max});
const I=(min=0)=>({minimum:min,maximum:Number.MAX_SAFE_INTEGER});
const field=(name,type,options={})=>({id:name,type,nullable:options.nullable??false,
  protected:options.protected??false,computed:false,...(options.constraints?{constraints:options.constraints}:{})});
const scope=[field('context_id','string',{protected:true,constraints:S()}),field('owner_id','string',{constraints:S()}),
  field('audience','string',{constraints:{enum:['admin','app']}})];
const common=['context_id','owner_id','audience'];
const model=(name,title,fields,primaryKey,indexes=[],relations=[])=>({id:name,title,scope:'context',
  contextField:'context_id',fields:[...scope,...fields],primaryKey,indexes,relations,
  permissions:[ref('permission','use')],deletion:{mode:'soft',requiresApproval:false},public:false});
const boxLink={id:'box',fields:[...common,'box_id'],target:ref('model','box'),
  targetFields:[...common,'id'],onDelete:'restrict'};
const draftLink={id:'draft',fields:[...common,'box_id','draft_id'],target:ref('model','draft'),
  targetFields:[...common,'box_id','id'],onDelete:'restrict'};
const models=[
  model('box','Boîtes locales',[
    field('id','string',{constraints:S()}),field('name','string',{constraints:S(120)}),
    field('address','string',{constraints:S(320,0)}),field('kind','string',{constraints:{enum:['local']}}),
    field('created_at','date-time'),field('updated_at','date-time'),field('revision','integer',{constraints:I(1)})],
    [...common,'id'],[{id:'recent-boxes',fields:[...common,'updated_at','id'],unique:false}]),
  model('message','Messages reçus ou envoyés',[
    field('box_id','string',{constraints:S()}),field('id','string',{constraints:S()}),
    field('direction','string',{constraints:{enum:['inbound','outbound']}}),
    field('from_addr','string',{constraints:S(320,0)}),field('to_addr','string',{constraints:S(2048,0)}),
    field('cc_addr','string',{constraints:S(2048,0)}),field('subject','string',{constraints:S(240,0)}),
    field('text_body','string',{constraints:S(16000,0)}),field('html_body','string',{constraints:S(32000,0)}),
    field('state','string',{constraints:{enum:['received','queued','sending','sent','delivered','bounced','failed','unknown']}}),
    field('folder','string',{constraints:{enum:['inbox','sent','outbox','archive','trash']}}),
    field('read_at','date-time',{nullable:true}),field('thread_id','string',{nullable:true,constraints:S()}),
    field('reply_to','string',{nullable:true,constraints:S(320)}),
    field('in_reply_to','string',{nullable:true,constraints:S(256)}),
    field('provider_message_id','string',{nullable:true,constraints:S(256)}),
    field('received_at','date-time',{nullable:true}),field('sent_at','date-time',{nullable:true}),
    field('created_at','date-time'),field('revision','integer',{constraints:I(1)})],
    [...common,'box_id','id'],[{id:'recent-messages',fields:[...common,'box_id','created_at','id'],unique:false}],
    [boxLink]),
  model('draft','Brouillons',[
    field('box_id','string',{constraints:S()}),field('id','string',{constraints:S()}),
    field('to_addr','string',{constraints:S(2048,0)}),field('cc_addr','string',{constraints:S(2048,0)}),
    field('bcc_addr','string',{constraints:S(2048,0)}),field('subject','string',{constraints:S(240,0)}),
    field('text_body','string',{constraints:S(16000,0)}),field('html_body','string',{constraints:S(32000,0)}),
    field('created_at','date-time'),field('updated_at','date-time'),field('revision','integer',{constraints:I(1)})],
    [...common,'box_id','id'],[{id:'recent-drafts',fields:[...common,'box_id','updated_at','id'],unique:false}],
    [boxLink]),
  model('file_metadata','Private file metadata',[
    field('file_id','string',{protected:true,constraints:S(67)}),field('file_owner','string',{protected:true,constraints:S(260)}),
    field('object_key','string',{protected:true,constraints:S(512)}),
    field('digest','string',{protected:true,constraints:{minLength:64,maxLength:64}}),
    field('byte_size','integer',{protected:true,constraints:I()}),
    field('content_type','string',{protected:true,constraints:S()}),field('filename','string',{protected:true,constraints:S(255)}),
    field('version','integer',{protected:true,constraints:I(1)}),
    field('state','string',{protected:true,constraints:{enum:['staging','staged','available','abandoned','deleted']}}),
    field('intent_id','string',{protected:true,constraints:S()}),field('generation','string',{protected:true,constraints:S()})],
    ['context_id','file_id'],[{id:'intent',fields:['context_id','intent_id','generation'],unique:true},
      {id:'object-key',fields:['context_id','object_key'],unique:true}]),
  model('draft_attachment','Pièces jointes privées des brouillons',[
    field('box_id','string',{constraints:S()}),field('draft_id','string',{constraints:S()}),
    field('file_id','string',{constraints:S(67)}),field('filename','string',{constraints:S(255)}),
    field('content_type','string',{constraints:S()}),field('byte_size','integer',{constraints:I()}),
    field('digest','string',{constraints:{minLength:64,maxLength:64}}),field('intent_id','string',{constraints:S()}),
    field('generation','string',{constraints:S()}),field('created_at','date-time')],
    [...common,'box_id','draft_id','file_id'],
    [{id:'by-draft',fields:[...common,'box_id','draft_id','created_at','file_id'],unique:false}],
    [boxLink,draftLink])
];
for(const name of ['draft','draft_attachment'])models.find(x=>x.id===name).deletion.mode='hard';
models.find(x=>x.id==='file_metadata').fields=models.find(x=>x.id==='file_metadata').fields
  .filter(x=>!['owner_id','audience'].includes(x.id));

const obj=(properties,required=Object.keys(properties))=>({type:'object',properties,required,additionalProperties:false});
const str=(max=128,min=1)=>({type:'string',minLength:min,maxLength:max});
const num=(min=0,max=Number.MAX_SAFE_INTEGER)=>({type:'integer',minimum:min,maximum:max});
const nullable=schema=>({anyOf:[schema,{type:'null'}]});
const schemas=[],schema=(name,value)=>{schemas.push({id:name,schema:value});return {schemaId:name};};
const box=obj({id:str(),name:str(120),address:str(320,0),kind:{const:'local'},revision:num(1)});
const draft=obj({id:str(),boxId:str(),to:str(2048,0),cc:str(2048,0),bcc:str(2048,0),
  subject:str(240,0),text:str(16000,0),html:str(32000,0),updatedAt:str(35),revision:num(1)});
const message=obj({id:str(),boxId:str(),direction:{type:'string',enum:['inbound','outbound']},
  from:str(320,0),to:str(2048,0),cc:str(2048,0),subject:str(240,0),text:str(16000,0),
  html:str(32000,0),state:{type:'string',enum:['received','queued','sending','sent','delivered','bounced','failed','unknown']},
  folder:{type:'string',enum:['inbox','sent','outbox','archive','trash']},read:{type:'boolean'},
  threadId:nullable(str()),replyTo:nullable(str(320)),inReplyTo:nullable(str(256)),
  receivedAt:nullable(str(35)),sentAt:nullable(str(35)),revision:num(1)});
const attachment=obj({fileId:str(67),filename:str(255),contentType:str(),byteSize:num(),
  reference:obj({fileId:str(67),intentId:str(),generation:str(),digest:str(64)})});
const page=item=>obj({items:{type:'array',items:item,maxItems:50},nextCursor:nullable(str(2048))});
const listInput=schema('box-list-input',obj({limit:num(1,50),cursor:str(2048)},['limit']));
const boxPage=schema('box-page-output',page(box));
const boxCreateInput=schema('box-create-input',obj({requestKey:str(),name:str(120),address:str(320,0)}));
const boxOutput=schema('box-output',obj({box}));
const messageListInput=schema('message-list-input',obj({boxId:str(),limit:num(1,50),cursor:str(2048),
  folder:{type:'string',enum:['inbox','sent','outbox','archive','trash']},unread:{type:'boolean'},query:str(240),
  threadId:str()},['boxId','limit']));
const messagePage=schema('message-page-output',page(message));
const messageReadInput=schema('message-read-input',obj({boxId:str(),messageId:str()}));
const messageOutput=schema('message-output',obj({message}));
const messageUpdateInput=schema('message-update-input',obj({requestKey:str(),boxId:str(),messageId:str(),
  revision:num(1),folder:{type:'string',enum:['inbox','sent','outbox','archive','trash']},read:{type:'boolean'}},
  ['requestKey','boxId','messageId','revision']));
const draftListInput=schema('draft-list-input',obj({boxId:str(),limit:num(1,50),cursor:str(2048),query:str(240)},['boxId','limit']));
const draftPage=schema('draft-page-output',page(draft));
const draftCreateInput=schema('draft-create-input',obj({requestKey:str(),boxId:str()}));
const draftReadInput=schema('draft-read-input',obj({boxId:str(),draftId:str()}));
const draftOutput=schema('draft-output',obj({draft}));
const draftSaveInput=schema('draft-save-input',obj({requestKey:str(),boxId:str(),draftId:str(),revision:num(1),
  to:str(2048,0),cc:str(2048,0),bcc:str(2048,0),subject:str(240,0),text:str(16000,0),html:str(32000,0)}));
const draftDeleteInput=schema('draft-delete-input',obj({requestKey:str(),boxId:str(),draftId:str(),revision:num(1)}));
const deletedOutput=schema('deleted-output',obj({deleted:{const:true}}));
const attachmentListInput=schema('attachment-list-input',obj({boxId:str(),draftId:str(),limit:num(1,50),
  cursor:str(2048)},['boxId','draftId','limit']));
const attachmentPage=schema('attachment-page-output',page(attachment));
const staged=obj({fileId:str(67),intentId:str(),generation:str(),digest:str(64)});
const attachmentLinkInput=schema('attachment-link-input',obj({requestKey:str(),boxId:str(),draftId:str(),
  revision:num(1),staged}));
const attachmentOutput=schema('attachment-output',obj({attachment,draft}));
const attachmentUnlinkInput=schema('attachment-unlink-input',obj({requestKey:str(),boxId:str(),draftId:str(),
  revision:num(1),fileId:str(67)}));
const attachmentUnlinkOutput=schema('attachment-unlink-output',obj({draft,removed:{const:true}}));
const empty=schema('empty-input',obj({}));
const transportOutput=schema('transport-output',obj({state:{const:'unavailable'},send:{const:false},receive:{const:false}}));
const sendInput=schema('message-send-input',obj({requestKey:str(),boxId:str(),draftId:str(),revision:num(1)}));
const sendOutput=schema('message-send-output',obj({message}));
const viewInput=schema('messaging-view-input',obj({boxId:str()},[]));
const panelState=schema('messaging-panel-state',obj({boxId:str(),draftId:str()},[]));

const permission={id:'use',title:'Utiliser sa messagerie',audiences:['admin','app'],
  actors:['user','delegated-user','machine'],scopes:['messaging.use'],context:'required',default:'deny',
  resources:[...models.map(x=>ref('model',x.id)),ref('file','attachments')],
  actions:['read','create','update','delete','execute'],enforcement:{request:true,commit:true},public:false};
const errors=['invalid_input','unauthorized','forbidden','not_found','conflict','rate_limited','unavailable','unknown']
  .map(code=>({code,retryable:['rate_limited','unavailable','unknown'].includes(code),outcome:code==='unknown'?'unknown':'rejected'}));
const operations=[];
function operation(name,title,kind,input,output,reads=[],writes=[],options={}){
  const command=kind==='command';
  operations.push({id:name,title,kind,input,output,permissions:[ref('permission','use')],
    audiences:['admin','app'],actors:['user','delegated-user','machine'],context:'required',
    handler:{path:'module/operations.ts',export:options.exportName},
    effects:{reads:reads.map(x=>ref('model',x)),writes:writes.map(x=>ref('model',x)),emits:[],calls:[],providers:[]},
    errors,pagination:options.pagination??{mode:'none'},
    idempotency:command?{mode:'required',keyField:'requestKey',scope:'actor-context-operation',retentionSeconds:86400}:{mode:'none'},
    approval:{mode:'none'},concurrency:options.concurrency??{mode:'none'},
    execution:{maxDurationMs:10000,maxItems:options.maxItems??100,resumable:false},
    audit:{required:true,redactFields:['to','cc','bcc','subject','text','html','address']},public:false});
}
const pagination={mode:'cursor',cursorField:'cursor',limitField:'limit',maxItems:50};
operation('box.list','Lister ses boîtes','query',listInput,boxPage,['box'],[],{exportName:'boxList',pagination,maxItems:50});
operation('box.create','Créer une boîte locale','command',boxCreateInput,boxOutput,[],['box'],{exportName:'boxCreate'});
operation('message.list','Lister les messages','query',messageListInput,messagePage,['box','message'],[],{exportName:'messageList',pagination,maxItems:50});
operation('message.read','Lire un message','query',messageReadInput,messageOutput,['box','message'],[],{exportName:'messageRead'});
operation('message.update','Classer ou marquer un message','command',messageUpdateInput,messageOutput,
  ['box','message'],['message'],{exportName:'messageUpdate',concurrency:{mode:'object-version',versionField:'revision'}});
operation('draft.list','Lister les brouillons','query',draftListInput,draftPage,['box','draft'],[],{exportName:'draftList',pagination,maxItems:50});
operation('draft.create','Créer un brouillon','command',draftCreateInput,draftOutput,['box'],['draft'],{exportName:'draftCreate'});
operation('draft.read','Lire un brouillon','query',draftReadInput,draftOutput,['box','draft'],[],{exportName:'draftRead'});
operation('draft.save','Enregistrer un brouillon','command',draftSaveInput,draftOutput,['box','draft'],['draft'],
  {exportName:'draftSave',concurrency:{mode:'object-version',versionField:'revision'}});
operation('draft.delete','Supprimer un brouillon vide de pièces jointes','command',draftDeleteInput,deletedOutput,
  ['box','draft','draft_attachment'],['draft'],{exportName:'draftDelete',concurrency:{mode:'object-version',versionField:'revision'}});
operation('attachment.list','Lister les pièces jointes','query',attachmentListInput,attachmentPage,
  ['box','draft','draft_attachment'],[],{exportName:'attachmentList',pagination,maxItems:52});
operation('attachment.link','Lier une pièce jointe privée','command',attachmentLinkInput,attachmentOutput,
  ['box','draft'],['draft','draft_attachment'],{exportName:'attachmentLink',concurrency:{mode:'object-version',versionField:'revision'}});
operations.at(-1).effects.writes.push(ref('file','attachments'));
operation('attachment.unlink','Détacher une pièce jointe','command',attachmentUnlinkInput,attachmentUnlinkOutput,
  ['box','draft','draft_attachment'],['draft','draft_attachment'],
  {exportName:'attachmentUnlink'});
operation('transport.status','Lire le statut du transport','query',empty,transportOutput,[],[],{exportName:'transportStatus'});
operation('message.send','Envoyer un brouillon','command',sendInput,sendOutput,['box','draft','draft_attachment'],[],
  {exportName:'messageSend',concurrency:{mode:'object-version',versionField:'revision'}});
const category={id:'attachments',metadataModel:ref('model','file_metadata'),contextField:'context_id',ownerField:'file_owner',
  storageFields:{id:'file_id',objectKey:'object_key',digest:'digest',byteSize:'byte_size',contentType:'content_type',
    filename:'filename',version:'version',state:'state',intentId:'intent_id',generation:'generation'},
  mimeTypes:['text/plain','application/pdf','image/png','image/jpeg'],maxBytes:10*1024*1024,public:false,
  permissions:[ref('permission','use')],attachment:{models:[ref('model','draft')],multiple:true},deletion:'restrict'};
const api=[];
for(const audience of ['admin','app'])for(const op of operations){
  const command=op.kind==='command',properties=schemas.find(x=>x.id===op.input.schemaId).schema.properties;
  const parameters=command?[]:Object.entries(properties).filter(([,spec])=>['string','integer','boolean'].includes(spec.type))
    .map(([name])=>({name:name.replaceAll(/[A-Z]/g,c=>'_'+c.toLowerCase()),in:'query',inputField:name,
      required:schemas.find(x=>x.id===op.input.schemaId).schema.required.includes(name)}));
  api.push({id:`${audience}.${op.id}`,method:command?'POST':'GET',path:`/api/${audience}/messaging/${op.id.replaceAll('.','/')}`,
    operation:ref('operation',op.id),audience,auth:['session','oauth','api-token'],parameters,input:op.input,output:op.output,
    rateLimit:{requests:60,windowSeconds:60}});
}
const m=structuredClone(template);
const skillPath='plugin/skills/compose-message.md';
const skillIntegrity=`sha256-${createHash('sha256').update(readFileSync(new URL(skillPath,root))).digest('hex')}`;
m.identity={id,title:'Messagerie native',publisher:'creezio',origin:'https://github.com/creezio/Creezio-D1R2',
  version:'0.0.0',source:{kind:'snapshot',revision:'t18-messaging-v1',
    integrity:`sha256-${createHash('sha256').update('t18-messaging-v1').digest('hex')}`},
  license:{expression:'NOASSERTION',file:'LICENSE'}};
m.compatibility={core:'^0.0.0',sdk:'^1.0.0',requiredCapabilities:['runtime.worker','data.d1.shared','files.r2.shared'],
  optionalCapabilities:[]};
m.entrypoints={server:{path:'module/entry.server.ts',export:'messaging'},
  ui:{path:'ui/index.tsx',export:'MessagingView'},plugin:{manifest:'plugin/plugin.json',mcp:'plugin/mcp.json',
    contributions:{path:'plugin/contributions.ts',export:'contributions'}}};
m.dependencies=[{moduleId:'creezio.access',origin:'https://github.com/creezio/Creezio-D1R2',versionRange:'^0.0.0',
  optional:false,contracts:[],whenAbsent:'block',whenIncompatible:'block',autoInstall:false}];
m.contracts={schemas,models,files:[category],events:[],settings:[],search:[],permissions:[permission],operations,api,
  mcp:{tools:operations.map(op=>({id:op.id,name:`messaging_${op.id.replaceAll('.','_')}`,
    operation:ref('operation',op.id),audiences:['admin','app'],auth:['oauth','api-token'],input:op.input,output:op.output,
    annotations:{readOnly:op.kind==='query',destructive:op.id==='draft.delete',idempotent:op.kind==='query',openWorld:op.id==='message.send'},
    textFallback:true})),resources:[],prompts:[],skills:[{id:'compose-message',path:skillPath,
    audiences:['admin','app'],operations:['transport.status','box.list','box.create','draft.create','draft.save','attachment.link']
      .map(name=>ref('operation',name)),resources:[],integrity:skillIntegrity}]},
  ui:{views:[{id:'admin',title:'Messagerie',surfaces:['workspace'],route:'/admin/messaging',
    component:{path:'ui/index.tsx',export:'MessagingView'},permissions:[ref('permission','use')],
    operations:operations.map(op=>ref('operation',op.id)),input:viewInput,
    panel:{identityFields:[],navigation:'sdk',retention:'preserve',inactiveEffects:'suspend',stateSchema:panelState}},
    {id:'front',title:'Messagerie',surfaces:['front'],route:'/messaging',
      component:{path:'ui/index.tsx',export:'MessagingView'},permissions:[ref('permission','use')],
      operations:operations.map(op=>ref('operation',op.id)),input:viewInput,
      panel:{identityFields:[],navigation:'sdk',retention:'preserve',inactiveEffects:'suspend',stateSchema:panelState}}],
    navigation:[{id:'messaging-admin',title:'Messagerie',view:ref('view','admin'),permissions:[ref('permission','use')],surfaces:['workspace'],order:30},
      {id:'messaging-front',title:'Messagerie',view:ref('view','front'),permissions:[ref('permission','use')],surfaces:['front'],order:30}],
    slots:[],front:{mode:'provided'},themes:[],styles:[]},widgets:[],publicContracts:[]};
m.documentation.versionBinding={moduleVersion:'0.0.0',sourceRevision:'t18-messaging-v1'};
for(const suite of ['backend','ui','api-mcp','package','docs'])m.validation.suites[suite].tests=[`tests/${suite}/contract.test.mjs`];
m.validation.suites.widgets.mode='not-applicable';m.validation.suites.widgets.tests=['tests/widgets/contract.test.mjs'];
m.validation.suites.widgets.justification={reason:'Native messaging exposes text MCP tools but no widget renderer.',
  policyRule:'messaging.text-tools-only'};
m.packaging.runtime.files=['module/manifest.json','module/models.json','module/entry.server.ts','module/operations.ts',
  'module/service.ts','ui/contracts.ts','ui/index.tsx','ui/presentation.tsx','ui/rich-editor.tsx',
  'README.md','prd.md','CHANGELOG.md','LICENSE','plugin/plugin.json',
  'plugin/mcp.json','plugin/contributions.ts',skillPath];
m.packaging.validation.files=['AGENTS.md','FILES.md','interview.md','TODO.md','gate.mjs','module/generate-manifest.mjs',
  'ci/run-suite.mjs','tests/helpers.mjs',...['backend','ui','api-mcp','widgets','package','docs']
    .flatMap(name=>[`ci/${name}.mjs`,`tests/${name}/contract.test.mjs`])];
m.packaging.validationBinding={moduleId:id,moduleVersion:'0.0.0',sourceRevision:'t18-messaging-v1'};
m.lifecycle.absent={widgets:{reason:'Text-only MCP tools do not require a widget renderer.',policyRule:'messaging.text-tools-only'}};
m.lifecycle.configuration='explicit-state';
writeFileSync(new URL('module/models.json',root),JSON.stringify(models,null,2)+'\n');
writeFileSync(new URL('module/manifest.json',root),JSON.stringify(m,null,2)+'\n');
