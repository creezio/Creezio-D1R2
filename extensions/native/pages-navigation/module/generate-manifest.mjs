import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

const root=new URL('../',import.meta.url);
const template=JSON.parse(readFileSync(new URL('module/manifest.json',root),'utf8'));
const id='creezio.pages-navigation',sourceRevision='t21-pages-navigation-v5',
  ref=(kind,name)=>({moduleId:id,kind,id:name});
const S=(max=128,min=1)=>({minLength:min,maxLength:max});
const I=(min=0)=>({minimum:min,maximum:Number.MAX_SAFE_INTEGER});
const field=(name,type,options={})=>({id:name,type,nullable:options.nullable??false,
  protected:options.protected??false,computed:false,...(options.constraints?{constraints:options.constraints}:{})});
const model=(name,title,fields,primaryKey,indexes=[],relations=[],permissions=['edit'])=>({id:name,title,
  scope:'context',contextField:'context_id',fields:[field('context_id','string',{protected:true,constraints:S()}),...fields],
  primaryKey,indexes,relations,permissions:permissions.map(name=>ref('permission',name)),
  deletion:{mode:'soft',requiresApproval:false},public:false});
const models=[
  model('page','Pages éditoriales',[
    field('id','string',{constraints:S()}),field('slug','string',{constraints:S(160)}),
    field('title','string',{constraints:S(240)}),field('draft_sections','json'),
    field('draft_settings','json'),field('draft_seo','json'),
    field('published_slug','string',{nullable:true,constraints:S(160)}),
    field('published_title','string',{nullable:true,constraints:S(240)}),
    field('published_sections','json',{nullable:true}),field('published_settings','json',{nullable:true}),
    field('published_seo','json',{nullable:true}),field('created_at','date-time'),
    field('updated_at','date-time'),field('published_at','date-time',{nullable:true}),
    field('revision','integer',{constraints:I(1)}),field('published_revision','integer',{constraints:I()})],
    ['context_id','id'],[{id:'recent-pages',fields:['context_id','updated_at','id'],unique:false},
      {id:'by-slug',fields:['context_id','slug'],unique:true},
      {id:'by-published-slug',fields:['context_id','published_slug'],unique:true}],[],['edit','view']),
  model('navigation','Navigation éditoriale',[
    field('id','string',{constraints:{enum:['primary']}}),field('draft_items','json'),
    field('published_items','json'),field('updated_at','date-time'),
    field('published_at','date-time',{nullable:true}),field('revision','integer',{constraints:I(1)}),
    field('published_revision','integer',{constraints:I()})],['context_id','id'],[],[],['edit','view']),
  model('file_metadata','Private media file metadata',[
    field('file_id','string',{protected:true,constraints:S(67)}),field('file_owner','string',{protected:true,constraints:S(260)}),
    field('object_key','string',{protected:true,constraints:S(512)}),
    field('digest','string',{protected:true,constraints:{minLength:64,maxLength:64}}),
    field('byte_size','integer',{protected:true,constraints:I()}),
    field('content_type','string',{protected:true,constraints:S()}),field('filename','string',{protected:true,constraints:S(255)}),
    field('version','integer',{protected:true,constraints:I(1)}),
    field('state','string',{protected:true,constraints:{enum:['staging','staged','available','abandoned','deleted']}}),
    field('intent_id','string',{protected:true,constraints:S()}),field('generation','string',{protected:true,constraints:S()})],
    ['context_id','file_id'],[{id:'intent',fields:['context_id','intent_id','generation'],unique:true},
      {id:'object-key',fields:['context_id','object_key'],unique:true}],[],['edit','view']),
  model('page_media','Médias associés aux pages',[
    field('page_id','string',{constraints:S()}),field('file_id','string',{constraints:S(67)}),
    field('filename','string',{constraints:S(255)}),field('content_type','string',{constraints:S()}),
    field('byte_size','integer',{constraints:I()}),field('digest','string',{constraints:{minLength:64,maxLength:64}}),
    field('intent_id','string',{constraints:S()}),field('generation','string',{constraints:S()}),
    field('created_at','date-time')],['context_id','page_id','file_id'],
    [{id:'by-page',fields:['context_id','page_id','created_at','file_id'],unique:false}],
    [{id:'page',fields:['context_id','page_id'],target:ref('model','page'),
      targetFields:['context_id','id'],onDelete:'restrict'}]),
  model('page_publication','État de publication des médias',[
    field('page_id','string',{constraints:S()}),
    field('state','string',{constraints:{enum:['published']}}),
    field('published_revision','integer',{constraints:I(1)})],['context_id','page_id'],[],
    [{id:'page',fields:['context_id','page_id'],target:ref('model','page'),
      targetFields:['context_id','id'],onDelete:'restrict'}],['edit','view']),
  // A row exists only for an explicitly public revision. Existing publications stay protected.
  model('public_page','Exposition anonyme explicite du snapshot',[
    field('page_id','string',{constraints:S()}),
    field('published_revision','integer',{constraints:I(1)}),
    field('enabled_at','date-time')],['context_id','page_id'],[],
    [{id:'publication',fields:['context_id','page_id'],target:ref('model','page_publication'),
      targetFields:['context_id','page_id'],onDelete:'restrict'}],['edit']),
  model('published_page_media','Médias du snapshot publié',[
    field('page_id','string',{constraints:S()}),field('file_id','string',{constraints:S(67)}),
    field('filename','string',{constraints:S(255)}),field('content_type','string',{constraints:S()}),
    field('byte_size','integer',{constraints:I()}),
    field('digest','string',{constraints:{minLength:64,maxLength:64}}),
    field('intent_id','string',{constraints:S()}),field('generation','string',{constraints:S()}),
    field('position','integer',{constraints:I(0,4)})],['context_id','page_id','file_id'],
    [{id:'by-page',fields:['context_id','page_id','position','file_id'],unique:false}],
    [{id:'publication',fields:['context_id','page_id'],target:ref('model','page_publication'),
      targetFields:['context_id','page_id'],onDelete:'restrict'}],['edit','view']),
  model('sidebar_overrides','Présentation de la barre latérale du workspace',[
    field('id','string',{constraints:{enum:['workspace']}}),field('overrides','json'),
    field('revision','integer',{constraints:I(1)}),field('updated_at','date-time'),
    field('updated_by','string',{constraints:S()})],['context_id','id'],[],[],['sidebar.manage','sidebar.read'])
];
models.find(x=>x.id==='page_media').deletion.mode='hard';
models.find(x=>x.id==='published_page_media').deletion.mode='hard';
models.find(x=>x.id==='public_page').deletion.mode='hard';
const obj=(properties,required=Object.keys(properties))=>({type:'object',properties,required,additionalProperties:false});
const str=(max=128,min=1)=>({type:'string',minLength:min,maxLength:max});
const num=(min=0,max=Number.MAX_SAFE_INTEGER)=>({type:'integer',minimum:min,maximum:max});
const nullable=x=>({anyOf:[x,{type:'null'}]});
const schemas=[],schema=(name,value)=>{schemas.push({id:name,schema:value});return {schemaId:name};};
const section=obj({id:str(),kind:{type:'string',enum:['hero','features','pricing','cta','footer']},
  position:num(0,10000),enabled:{type:'boolean'},content:{type:'object',additionalProperties:true}},
['id','kind','position','enabled','content']);
const sections={type:'array',items:section,maxItems:30};
const settings=obj({brandName:str(500,0),tagline:str(500,0),accent:str(500,0),
  background:str(500,0),logoUrl:str(500,0),logoFileId:str(67,0)},[]);
const seo=obj({title:str(240,0),description:str(500,0),canonical:str(240,0)},[]);
const pageSummary=obj({id:str(),slug:str(160),title:str(240),revision:num(1),
  publishedRevision:num(),updatedAt:str(35),publishedAt:nullable(str(35))});
const draft=obj({...pageSummary.properties,sections,settings,seo});
const published=obj({id:str(),slug:str(160),title:str(240),sections,settings,seo,
  publishedRevision:num(1),publishedAt:str(35)});
const publishedSummary=obj({id:str(),slug:str(160),title:str(240),publishedRevision:num(1),publishedAt:str(35)});
const navItem=obj({id:str(),label:str(120),href:str(512),icon:str(80,0),group:str(80,0),
  order:num(0,10000),hidden:{type:'boolean'},pageSlug:str(160)},
  ['id','label','href','icon','group','order','hidden']);
const navItems={type:'array',items:navItem,maxItems:100};
const navigation=obj({items:navItems,revision:num(),publishedRevision:num(),
  updatedAt:nullable(str(35)),publishedAt:nullable(str(35))});
const publishedNavigation=obj({items:navItems,publishedRevision:num(),publishedAt:nullable(str(35))});
const media=obj({pageId:str(),fileId:str(67),filename:str(255),contentType:str(),byteSize:num(),
  reference:obj({fileId:str(67),intentId:str(),generation:str(),digest:str(64)})});
const pageOutput=schema('page-output',obj({page:draft}));
const publishedOutput=schema('published-page-output',obj({page:published}));
const pageIdInput=schema('page-id-input',obj({pageId:str()}));
const visibilityOutput=schema('page-visibility-output',obj({visibility:{type:'string',enum:['protected','public']},
  slug:nullable(str(160))}));
const publishedSlugInput=schema('published-slug-input',obj({slug:str(160)}));
const publishedSlugOutput=schema('published-slug-output',obj({pageId:str(),slug:str(160)}));
const listInput=schema('page-list-input',obj({limit:num(1,50),cursor:str(2048)},['limit']));
const pageListOutput=schema('page-list-output',obj({items:{type:'array',items:pageSummary,maxItems:50},nextCursor:nullable(str(2048))}));
const publishedListOutput=schema('published-list-output',obj({items:{type:'array',items:publishedSummary,maxItems:50},nextCursor:nullable(str(2048))}));
const createInput=schema('page-create-input',obj({requestKey:str(),id:str(),slug:str(160),title:str(240)}));
const saveInput=schema('page-save-input',obj({requestKey:str(),pageId:str(),revision:num(1),
  slug:str(160),title:str(240),sections,settings,seo}));
const stateInput=schema('page-state-input',obj({requestKey:str(),pageId:str(),revision:num(1)}));
const publishInput=schema('page-publish-input',obj({requestKey:str(),pageId:str(),revision:num(1),
  visibility:{type:'string',enum:['protected','public']}},['requestKey','pageId','revision']));
const navOutput=schema('navigation-output',obj({navigation}));
const publishedNavOutput=schema('published-navigation-output',obj({navigation:publishedNavigation}));
const navSaveInput=schema('navigation-save-input',obj({requestKey:str(),revision:num(),items:navItems}));
const navStateInput=schema('navigation-state-input',obj({requestKey:str(),revision:num(1)}));
const empty=schema('empty-input',obj({}));
const mediaListInput=schema('media-list-input',obj({pageId:str(),limit:num(1,50),cursor:str(2048)},['pageId','limit']));
const mediaListOutput=schema('media-list-output',obj({items:{type:'array',items:media,maxItems:50},nextCursor:nullable(str(2048))}));
const publishedMediaInput=schema('published-media-input',obj({pageId:str()}));
const publishedMediaOutput=schema('published-media-output',obj({items:{type:'array',items:media,maxItems:5}}));
const staged=obj({fileId:str(67),intentId:str(),generation:str(),digest:str(64)});
const mediaLinkInput=schema('media-link-input',obj({requestKey:str(),pageId:str(),revision:num(1),staged}));
const mediaLinkOutput=schema('media-link-output',obj({media,page:pageSummary}));
const mediaUnlinkInput=schema('media-unlink-input',obj({requestKey:str(),pageId:str(),revision:num(1),fileId:str(67)}));
const mediaUnlinkOutput=schema('media-unlink-output',obj({removed:{const:true},page:pageSummary}));
const sidebarOverride=obj({id:str(),hidden:{type:'boolean'},title:str(120),order:num(0,10000)},['id']);
const sidebarEdits={type:'array',items:sidebarOverride,maxItems:100};
const sidebarResetIds={type:'array',items:str(),maxItems:100};
const sidebarEntry=obj({id:str(),moduleId:str(),viewId:str(),title:str(240),order:num(0,10000),
  route:str(512),audiences:{type:'array',items:{type:'string',enum:['admin','app']},maxItems:2},
  permissionIds:{type:'array',items:str(257),maxItems:64},available:{type:'boolean'},
  hidden:{type:'boolean'},displayTitle:str(240),displayOrder:num(0,10000)});
const sidebarItem=obj({id:str(),viewId:str(),title:str(240),order:num(0,10000)});
const sidebarMeta={compositionDigest:str(128),contextId:str(),audience:{type:'string',enum:['admin','app']},
  sessionId:nullable(str()),epoch:nullable(num()),revision:num()};
const sidebarCatalogOutput=schema('sidebar-catalog-output',obj({...sidebarMeta,
  entries:{type:'array',items:sidebarEntry,maxItems:1000}}));
const sidebarResolvedOutput=schema('sidebar-resolved-output',obj({...sidebarMeta,
  items:{type:'array',items:sidebarItem,maxItems:1000}}));
const sidebarSaveInput=schema('sidebar-save-input',obj({requestKey:str(128),expectedRevision:num(),
  edits:sidebarEdits,resetIds:sidebarResetIds}));
const sidebarSaveOutput=schema('sidebar-save-output',obj({revision:num(1),updatedAt:str(35),updatedBy:str()}));
const viewInput=schema('editor-view-input',obj({pageId:str(),slug:str(160)},[]));
const pendingCommand=obj({sessionId:str(),audience:{type:'string',enum:['admin','app']},contextId:str(),
  bindingId:str(257),requestKey:str(512),intent:str(64),targetId:str()},
  ['sessionId','audience','contextId','bindingId','requestKey']);
const panelState=schema('editor-panel-state',obj({sessionId:str(),audience:{type:'string',enum:['admin','app']},
  contextId:str(),pageId:str(),tab:{type:'string',enum:['pages','navigation','sidebar']},
  pending:pendingCommand},[]));
const permissions=[
  {id:'edit',title:'Éditer et publier les pages',audiences:['admin'],actors:['user','delegated-user','machine'],
    scopes:['pages.edit'],context:'required',default:'deny',resources:[...models.map(x=>ref('model',x.id)),ref('file','media')],
    actions:['read','create','update','delete','execute'],enforcement:{request:true,commit:true},public:false},
  {id:'view',title:'Lire les contenus publiés',audiences:['admin','app'],actors:['user','delegated-user','machine'],
    scopes:['pages.view'],context:'required',default:'deny',resources:[ref('model','page'),ref('model','navigation'),
      ref('model','page_publication'),ref('model','published_page_media'),ref('model','file_metadata'),ref('file','media')],
    actions:['read','execute'],enforcement:{request:true,commit:true},public:false},
  {id:'sidebar.manage',title:'Gérer la présentation de la barre latérale',audiences:['admin'],
    actors:['user','delegated-user','machine'],scopes:['pages.sidebar.manage'],context:'required',default:'deny',
    resources:[ref('model','sidebar_overrides')],actions:['read','create','update','execute'],
    enforcement:{request:true,commit:true},public:false},
  {id:'sidebar.read',title:'Lire la présentation de la barre latérale',audiences:['admin','app'],
    actors:['user','delegated-user','machine'],scopes:['pages.sidebar.read'],context:'required',default:'deny',
    resources:[ref('model','sidebar_overrides')],actions:['read','execute'],
    enforcement:{request:true,commit:true},public:false}
];
const errors=['invalid_input','unauthorized','forbidden','not_found','conflict','rate_limited','unavailable','unknown']
  .map(code=>({code,retryable:['rate_limited','unavailable','unknown'].includes(code),
    outcome:code==='unknown'?'unknown':'rejected'}));
const operations=[];
function operation(name,title,kind,input,output,reads=[],writes=[],options={}){
  const command=kind==='command',view=options.view===true,permission=options.permission??(view?'view':'edit');
  operations.push({id:name,title,kind,input,output,permissions:[ref('permission',permission)],
    audiences:view||permission==='sidebar.read'?['admin','app']:['admin'],actors:['user','delegated-user','machine'],context:'required',
    handler:{path:'module/operations.ts',export:options.exportName},
    effects:{reads:reads.map(x=>ref('model',x)),writes:writes.map(x=>ref('model',x)),emits:[],calls:[],providers:[]},
    errors,pagination:options.pagination??{mode:'none'},
    idempotency:command?{mode:'required',keyField:'requestKey',scope:'actor-context-operation',retentionSeconds:86400}:{mode:'none'},
    approval:{mode:'none'},concurrency:options.concurrency??{mode:'none'},
    execution:{maxDurationMs:10000,maxItems:options.maxItems??100,resumable:false},
    audit:{required:true,redactFields:['sections','settings','seo','items']},public:false});
}
const pagination={mode:'cursor',cursorField:'cursor',limitField:'limit',maxItems:50};
operation('page.list','Lister les pages éditoriales','query',listInput,pageListOutput,['page'],[],{exportName:'pageList',pagination,maxItems:50});
operation('page.create','Créer une page','command',createInput,pageOutput,[],['page'],{exportName:'pageCreate'});
operation('page.read','Lire le brouillon de page','query',pageIdInput,pageOutput,['page'],[],{exportName:'pageRead'});
operation('page.visibility','Lire la visibilité du snapshot','query',pageIdInput,visibilityOutput,
  ['page','public_page'],[],{exportName:'pageVisibility',maxItems:2});
operation('page.save','Enregistrer la page','command',saveInput,pageOutput,['page'],['page'],
  {exportName:'pageSave',concurrency:{mode:'object-version',versionField:'revision'}});
operation('page.preview','Prévisualiser le brouillon','query',pageIdInput,pageOutput,['page'],[],{exportName:'pagePreview'});
operation('page.publish','Publier le snapshot éditorial','command',publishInput,publishedOutput,
  ['page','page_media','page_publication','published_page_media','public_page'],
  ['page','page_publication','published_page_media','public_page'],
  {exportName:'pagePublish',maxItems:27});
operation('page.reset','Rétablir le brouillon depuis le publié','command',stateInput,pageOutput,
  ['page','published_page_media','page_media'],['page','page_media'],
  {exportName:'pageReset',maxItems:18,concurrency:{mode:'object-version',versionField:'revision'}});
operation('page.published.list','Lister les pages publiées','query',listInput,publishedListOutput,['page'],[],
  {exportName:'pagePublishedList',pagination,maxItems:50,view:true});
operation('page.published.read','Lire une page publiée','query',pageIdInput,publishedOutput,['page'],[],
  {exportName:'pagePublishedRead',view:true});
operation('page.published.resolve','Résoudre le slug publié','query',publishedSlugInput,publishedSlugOutput,['page'],[],
  {exportName:'pagePublishedResolve',view:true,maxItems:1});
operation('navigation.read','Lire la navigation en édition','query',empty,navOutput,['navigation'],[],{exportName:'navigationRead'});
operation('navigation.save','Enregistrer la navigation','command',navSaveInput,navOutput,['navigation'],['navigation'],
  {exportName:'navigationSave'});
operation('navigation.publish','Publier la navigation','command',navStateInput,publishedNavOutput,['navigation','page'],['navigation'],
  {exportName:'navigationPublish',maxItems:102,
    concurrency:{mode:'object-version',versionField:'revision'}});
operation('navigation.reset','Rétablir la navigation brouillon','command',navStateInput,navOutput,['navigation'],['navigation'],
  {exportName:'navigationReset',concurrency:{mode:'object-version',versionField:'revision'}});
operation('navigation.published','Lire la navigation publiée','query',empty,publishedNavOutput,['navigation'],[],
  {exportName:'navigationPublished',view:true});
operation('media.list','Lister les médias privés d’une page','query',mediaListInput,mediaListOutput,['page','page_media'],[],
  {exportName:'mediaList',pagination,maxItems:51});
operation('media.published.list','Lister les images liées du snapshot publié','query',publishedMediaInput,
  publishedMediaOutput,['page','page_publication','published_page_media'],[],
  {exportName:'publishedMediaList',view:true,maxItems:8});
operation('media.link','Lier un média privé','command',mediaLinkInput,mediaLinkOutput,['page'],['page','page_media'],
  {exportName:'mediaLink',concurrency:{mode:'object-version',versionField:'revision'}});
operations.at(-1).effects.writes.push(ref('file','media'));
operation('media.unlink','Détacher un média privé','command',mediaUnlinkInput,mediaUnlinkOutput,
  ['page','page_media'],['page','page_media'],{exportName:'mediaUnlink'});
operation('sidebar.catalog','Lire le catalogue de la barre latérale','query',empty,sidebarCatalogOutput,
  ['sidebar_overrides'],[],{exportName:'sidebarCatalog',permission:'sidebar.manage',maxItems:1});
operation('sidebar.resolved','Lire la barre latérale autorisée','query',empty,sidebarResolvedOutput,
  ['sidebar_overrides'],[],{exportName:'sidebarResolved',permission:'sidebar.read',maxItems:1});
operation('sidebar.save','Adapter la barre latérale','command',sidebarSaveInput,sidebarSaveOutput,
  ['sidebar_overrides'],['sidebar_overrides'],{exportName:'sidebarSave',permission:'sidebar.manage',maxItems:2});
const category={id:'media',metadataModel:ref('model','file_metadata'),contextField:'context_id',ownerField:'file_owner',
  storageFields:{id:'file_id',objectKey:'object_key',digest:'digest',byteSize:'byte_size',contentType:'content_type',
    filename:'filename',version:'version',state:'state',intentId:'intent_id',generation:'generation'},
  mimeTypes:['image/png','image/jpeg','image/webp'],maxBytes:10*1024*1024,
  public:false,permissions:[ref('permission','edit')],attachment:{models:[ref('model','page')],multiple:true},
  deletion:'restrict',linkedRead:{audiences:['admin','app'],permission:ref('permission','view'),
    linkModel:ref('model','published_page_media'),parentRelation:'publication',
    referenceFields:{fileId:'file_id',intentId:'intent_id',generation:'generation',digest:'digest'},
    when:{field:'state',equals:'published'}}};
const api=[];
for(const op of operations)for(const audience of op.audiences){
  const command=op.kind==='command',spec=schemas.find(x=>x.id===op.input.schemaId).schema;
  const parameters=command?[]:Object.entries(spec.properties).filter(([,s])=>['string','integer','boolean'].includes(s.type))
    .map(([name])=>({name:name.replaceAll(/[A-Z]/g,c=>'_'+c.toLowerCase()),in:'query',inputField:name,
      required:spec.required.includes(name)}));
  api.push({id:`${audience}.${op.id}`,method:command?'POST':'GET',
    path:`/api/${audience}/pages-navigation/${op.id.replaceAll('.','/')}`,
    operation:ref('operation',op.id),audience,auth:['session','oauth','api-token'],parameters,
    input:op.input,output:op.output,rateLimit:{requests:60,windowSeconds:60}});
}
const m=structuredClone(template),skillPath='plugin/skills/editorial.md';
const skillIntegrity=`sha256-${createHash('sha256').update(readFileSync(new URL(skillPath,root))).digest('hex')}`;
m.identity={id,title:'Pages et navigation',publisher:'creezio',origin:'https://github.com/creezio/Creezio-D1R2',
  version:'0.0.0',source:{kind:'snapshot',revision:sourceRevision,
    integrity:`sha256-${createHash('sha256').update(sourceRevision).digest('hex')}`},
  license:{expression:'NOASSERTION',file:'LICENSE'}};
m.compatibility={core:'^0.0.0',sdk:'^1.7.0',requiredCapabilities:['runtime.worker','data.d1.shared','files.r2.shared'],
  optionalCapabilities:[]};
m.entrypoints={server:{path:'module/entry.server.ts',export:'pagesNavigation'},
  ui:{path:'ui/index.tsx',export:'PagesNavigationAdminView'},
  publicPage:{renderer:{path:'ui/public-document.tsx',export:'renderPublicPage'},
    imageIds:{path:'ui/published-images.ts',export:'publishedImageIds'},stylesheet:'ui/landing.css',
    models:{page:ref('model','page'),pagePublication:ref('model','page_publication'),
      publicPage:ref('model','public_page'),navigation:ref('model','navigation'),
      publishedPageMedia:ref('model','published_page_media'),fileMetadata:ref('model','file_metadata')}},
  plugin:{manifest:'plugin/plugin.json',mcp:'plugin/mcp.json',
    contributions:{path:'plugin/contributions.ts',export:'contributions'}}};
m.dependencies=[{moduleId:'creezio.access',origin:'https://github.com/creezio/Creezio-D1R2',versionRange:'^0.0.0',
  optional:false,contracts:[],whenAbsent:'block',whenIncompatible:'block',autoInstall:false}];
m.contracts={schemas,models,files:[category],events:[],settings:[],search:[],permissions,operations,api,
  mcp:{tools:operations.map(op=>({id:op.id,name:`pages_${op.id.replaceAll('.','_')}`,
    operation:ref('operation',op.id),audiences:op.audiences,auth:['oauth','api-token'],input:op.input,output:op.output,
    annotations:{readOnly:op.kind==='query',destructive:op.id.endsWith('.reset')||op.id==='media.unlink',
      idempotent:op.kind==='query',openWorld:false},textFallback:true})),resources:[],prompts:[],
    skills:[{id:'editorial',path:skillPath,audiences:['admin'],operations:operations
      .filter(op=>op.audiences.length===1).map(op=>ref('operation',op.id)),resources:[],integrity:skillIntegrity}]},
  ui:{views:[{id:'admin',title:'Pages et navigation',surfaces:['workspace'],route:'/admin/pages',
    component:{path:'ui/index.tsx',export:'PagesNavigationAdminView'},permissions:[ref('permission','edit')],
    operations:operations.filter(op=>op.audiences.includes('admin')).map(op=>ref('operation',op.id)),input:viewInput,
    panel:{identityFields:[],navigation:'sdk',retention:'preserve',inactiveEffects:'suspend',stateSchema:panelState}},
    {id:'front',title:'Pages',surfaces:['front'],route:'/pages',
      component:{path:'ui/front-page.tsx',export:'PagesNavigationFrontView'},permissions:[ref('permission','view')],
      operations:operations.filter(op=>op.permissions[0].id==='view').map(op=>ref('operation',op.id)),input:viewInput,
      panel:{identityFields:[],navigation:'sdk',retention:'preserve',inactiveEffects:'suspend',stateSchema:panelState}},
    {id:'editorial-nav',title:'Navigation publiée',surfaces:['front'],route:'/pages/editorial-nav',
      component:{path:'ui/front-nav.tsx',export:'PublishedEditorialNavigation'},permissions:[ref('permission','view')],
      operations:[ref('operation','navigation.published'),ref('operation','page.published.resolve')],input:empty,
      panel:{identityFields:[],navigation:'sdk',retention:'preserve',inactiveEffects:'suspend'}}],
    navigation:[{id:'pages-navigation-admin',title:'Pages et navigation',view:ref('view','admin'),
      permissions:[ref('permission','edit')],surfaces:['workspace'],order:40},
      {id:'pages-navigation-front',title:'Pages',view:ref('view','front'),
        permissions:[ref('permission','view')],surfaces:['front'],order:40}],
    slots:[{id:'published-navigation',slot:'front.header',view:ref('view','editorial-nav'),
      permissions:[ref('permission','view')],surfaces:['front']}],
    front:{mode:'provided'},themes:[],styles:[]},widgets:[],publicContracts:[]};
m.documentation.versionBinding={moduleVersion:'0.0.0',sourceRevision};
for(const suite of ['backend','ui','api-mcp','package','docs'])m.validation.suites[suite].tests=[`tests/${suite}/contract.test.mjs`];
m.validation.suites.backend.tests.push('tests/backend/sidebar.test.mjs');
m.validation.suites.widgets.mode='not-applicable';m.validation.suites.widgets.tests=['tests/widgets/contract.test.mjs'];
m.validation.suites.widgets.justification={reason:'Published pages render through the front view, not an MCP widget.',
  policyRule:'pages-navigation.no-widget-renderer'};
m.packaging.runtime.files=['module/manifest.json','module/models.json','module/entry.server.ts','module/operations.ts',
  'module/service.ts','module/sidebar.ts','ui/contracts.ts','ui/index.tsx','ui/sidebar.tsx','ui/front-page.tsx','ui/front-nav.tsx',
  'ui/front-link.ts','ui/seo.ts','ui/prefabs.tsx','ui/public-document.tsx','ui/published-images.ts','ui/landing.css','ui/types.ts','ui/state.ts',
  'README.md','prd.md','CHANGELOG.md','LICENSE','plugin/plugin.json','plugin/mcp.json',
  'plugin/contributions.ts',skillPath];
m.packaging.validation.files=['AGENTS.md','FILES.md','interview.md','TODO.md','gate.mjs','module/generate-manifest.mjs',
  'ci/run-suite.mjs','tests/helpers.mjs','tests/backend/sidebar.test.mjs',...['backend','ui','api-mcp','widgets','package','docs']
    .flatMap(name=>[`ci/${name}.mjs`,`tests/${name}/contract.test.mjs`])];
m.packaging.validationBinding={moduleId:id,moduleVersion:'0.0.0',sourceRevision};
m.lifecycle.absent={widgets:{reason:'No MCP widget renderer is used for editorial pages.',
  policyRule:'pages-navigation.no-widget-renderer'}};
m.lifecycle.configuration='explicit-state';
writeFileSync(new URL('module/models.json',root),JSON.stringify(models,null,2)+'\n');
writeFileSync(new URL('module/manifest.json',root),JSON.stringify(m,null,2)+'\n');
