import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

const root=new URL('../',import.meta.url);
const template=JSON.parse(readFileSync(new URL('module/manifest.json',root),'utf8'));
const id='creezio.catalog',version='0.1.1',revision='t25-catalog-v2';
const ref=(kind,name)=>({moduleId:id,kind,id:name});
const length=(max,min=1)=>({minLength:min,maxLength:max});
const int=(min=0,max=Number.MAX_SAFE_INTEGER)=>({minimum:min,maximum:max});
const field=(id,type,options={})=>({id,type,nullable:options.nullable??false,
  protected:options.protected??false,computed:false,...(options.constraints?{constraints:options.constraints}:{})});
const model=(id,title,fields,primaryKey,indexes=[],relations=[],permissions=['manage','view'],publicModel=false)=>({
  id,title,scope:'context',contextField:'context_id',fields:[field('context_id','string',
    {protected:true,constraints:length(128)}),...fields],primaryKey,indexes,relations,
  permissions:permissions.map(name=>ref('permission',name)),
  deletion:{mode:'soft',requiresApproval:false},public:publicModel});
const category=model('category','Catégorie de catalogue',[
  field('id','string',{constraints:length(36)}),field('name','string',{constraints:length(120)}),
  field('slug','string',{constraints:length(80)}),field('parent_id','string',{nullable:true,constraints:length(36)}),
  field('position','integer',{constraints:int(0,100000)}),field('archived_at','date-time',{nullable:true}),
  field('revision','integer',{constraints:int(1)}),field('created_at','date-time'),field('updated_at','date-time')],
  ['context_id','id'],[{id:'by-slug',fields:['context_id','slug'],unique:true},
    {id:'by-position',fields:['context_id','position','id'],unique:false},
    {id:'by-parent',fields:['context_id','parent_id','id'],unique:false}]);
const product=model('product','Produit de catalogue',[
  field('id','string',{constraints:length(36)}),field('sku','string',{constraints:length(80)}),
  field('name','string',{constraints:length(160)}),field('description','string',{constraints:length(1200,0)}),
  field('attributes','json'),field('category_id','string',{nullable:true,constraints:length(36)}),
  field('price_minor','integer',{constraints:int(0,1_000_000_000_000)}),
  field('currency','string',{constraints:{minLength:3,maxLength:3}}),
  field('status','string',{constraints:{enum:['draft','published','archived']}}),
  field('revision','integer',{constraints:int(1)}),field('created_at','date-time'),field('updated_at','date-time')],
  ['context_id','id'],[{id:'by-sku',fields:['context_id','sku'],unique:true},
    {id:'by-updated',fields:['context_id','updated_at','id'],unique:false},
    {id:'by-category',fields:['context_id','category_id','updated_at','id'],unique:false}],
  [{id:'category',fields:['context_id','category_id'],target:ref('model','category'),
    targetFields:['context_id','id'],onDelete:'restrict'}]);
const metadata=model('file_metadata','Métadonnée privée des images',[field('file_id','string',
    {protected:true,constraints:length(67)}),field('file_owner','string',{protected:true,constraints:length(260)}),
  field('object_key','string',{protected:true,constraints:length(512)}),
  field('digest','string',{protected:true,constraints:{minLength:64,maxLength:64}}),
  field('byte_size','integer',{protected:true,constraints:int()}),
  field('content_type','string',{protected:true,constraints:length(128)}),
  field('filename','string',{protected:true,constraints:length(255)}),
  field('version','integer',{protected:true,constraints:int(1)}),
  field('state','string',{protected:true,constraints:{enum:['staging','staged','available','abandoned','deleted']}}),
  field('intent_id','string',{protected:true,constraints:length(128)}),
  field('generation','string',{protected:true,constraints:length(128)})],
  ['context_id','file_id'],[{id:'by-intent',fields:['context_id','intent_id','generation'],unique:true},
    {id:'by-object',fields:['context_id','object_key'],unique:true}],[],['manage','view']);
const media=model('product_media','Image liée à un produit',[
  field('product_id','string',{constraints:length(36)}),field('file_id','string',{constraints:length(67)}),
  field('filename','string',{constraints:length(255)}),field('content_type','string',{constraints:length(128)}),
  field('byte_size','integer',{constraints:int()}),field('digest','string',{constraints:{minLength:64,maxLength:64}}),
  field('intent_id','string',{constraints:length(128)}),field('generation','string',{constraints:length(128)}),
  field('created_at','date-time')],['context_id','product_id','file_id'],
  [{id:'by-product',fields:['context_id','product_id','created_at','file_id'],unique:false}],
  [{id:'product',fields:['context_id','product_id'],target:ref('model','product'),
    targetFields:['context_id','id'],onDelete:'restrict'}]);
media.deletion.mode='hard';
const models=[category,product,metadata,media];
const obj=(properties,required=Object.keys(properties))=>({type:'object',properties,required,additionalProperties:false});
const str=(max=128,min=1)=>({type:'string',minLength:min,maxLength:max});
const num=(min=0,max=Number.MAX_SAFE_INTEGER)=>({type:'integer',minimum:min,maximum:max});
const nullable=value=>({anyOf:[value,{type:'null'}]});
const attr=obj({key:str(64),value:str(160,0)}),attrs={type:'array',items:attr,maxItems:12};
const status={type:'string',enum:['draft','published','archived']};
const productFields={sku:str(80),name:str(160),description:str(1200,0),attributes:attrs,
  categoryId:nullable(str(36)),priceMinor:num(0,1_000_000_000_000),currency:str(3,3)};
const categoryFields={name:str(120),slug:str(80),position:num(0,100000)};
const categoryView=obj({id:str(36),...categoryFields,parentId:nullable(str(36)),
  archivedAt:nullable(str(35)),revision:num(1),createdAt:str(35),updatedAt:str(35)});
const fullProduct=obj({id:str(36),...productFields,status,revision:num(1),
  createdAt:str(35),updatedAt:str(35)});
const publishedProduct=obj({...fullProduct.properties,status:{const:'published'}});
const summary=obj({id:str(36),sku:str(80),name:str(160),categoryId:nullable(str(36)),
  priceMinor:num(0,1_000_000_000_000),currency:str(3,3),status,
  revision:num(1),updatedAt:str(35)});
const publishedSummary=obj({...summary.properties,status:{const:'published'}});
const mediaView=obj({productId:str(36),fileId:str(67),filename:str(255),contentType:str(128),
  byteSize:num(),digest:str(64,64),createdAt:str(35),reference:obj({fileId:str(67),
    intentId:str(128),generation:str(128),digest:str(64,64)})});
const schemas=[],schema=(id,value)=>{schemas.push({id,schema:value});return {schemaId:id};};
const requestKey=str(128),identity=str(36),revField=num(1);
const categoryCreateInput=schema('category-create-input',obj({requestKey,...categoryFields,
  parentId:nullable(identity)}));
const categoryUpdateInput=schema('category-update-input',obj({requestKey,id:identity,revision:revField,...categoryFields}));
const stateInput=schema('state-input',obj({requestKey,id:identity,revision:revField}));
const categoryListInput=schema('category-list-input',obj({limit:num(1,50),cursor:str(2048),
  includeArchived:{type:'boolean'}},['limit']));
const categoryOutput=schema('category-output',obj({category:categoryView}));
const categoryListOutput=schema('category-list-output',obj({items:{type:'array',items:categoryView,maxItems:50},
  nextCursor:nullable(str(2048)),complete:{type:'boolean'},scanned:num(0,500)}));
const productCreateInput=schema('product-create-input',obj({requestKey,...productFields}));
const productUpdateInput=schema('product-update-input',obj({requestKey,id:identity,revision:revField,...productFields}));
const productInput=schema('product-id-input',obj({id:identity}));
const productOutput=schema('product-output',obj({product:fullProduct}));
const publishedOutput=schema('published-product-output',obj({product:publishedProduct}));
const productListInput=schema('product-list-input',obj({limit:num(1,25),cursor:str(2048),
  query:str(120,0),categoryId:str(36),status},['limit']));
const productSearchInput=schema('product-search-input',obj({limit:num(1,25),cursor:str(2048),
  query:str(120,0),categoryId:str(36)},['limit']));
const productListOutput=schema('product-list-output',obj({items:{type:'array',items:summary,maxItems:25},
  nextCursor:nullable(str(2048)),complete:{type:'boolean'},scanned:num(0,500)}));
const productSearchOutput=schema('product-search-output',obj({items:{type:'array',items:publishedSummary,maxItems:25},
  nextCursor:nullable(str(2048)),complete:{type:'boolean'},scanned:num(0,500)}));
const mediaListInput=schema('media-list-input',obj({productId:identity}));
const mediaListOutput=schema('media-list-output',obj({items:{type:'array',items:mediaView,maxItems:5}}));
const mediaLinkInput=schema('media-link-input',obj({requestKey,productId:identity,revision:revField,
  staged:obj({fileId:str(67),intentId:str(128),generation:str(128),digest:str(64,64)})}));
const mediaLinkOutput=schema('media-link-output',obj({media:mediaView,product:fullProduct}));
const mediaUnlinkInput=schema('media-unlink-input',obj({requestKey,productId:identity,revision:revField,fileId:str(67)}));
const mediaUnlinkOutput=schema('media-unlink-output',obj({removed:{const:true},product:fullProduct}));
const viewInput=schema('catalog-view-input',obj({id:identity},[]));
const pendingCommand=obj({sessionId:str(128),audience:{type:'string',enum:['admin','app']},
  contextId:str(128),bindingId:str(257),requestKey:str(512),intent:str(64),targetId:str(128)},
  ['sessionId','audience','contextId','bindingId','requestKey']);
const panelState=schema('catalog-panel-state',obj({sessionId:str(128),
  audience:{type:'string',enum:['admin','app']},contextId:str(128),
  tab:{type:'string',enum:['products','categories']},query:str(120,0),
  categoryId:str(36,0),selectedId:str(36,0),pending:pendingCommand},[]));
const widgetState=schema('widget-state',obj({id:identity,query:str(120,0)},[]));
const permissions=[{id:'manage',title:'Gérer le catalogue',audiences:['admin'],
  actors:['user','delegated-user','machine'],scopes:['catalog.manage'],context:'required',default:'deny',
  resources:[...models.map(model=>ref('model',model.id)),ref('file','images')],
  actions:['read','create','update','delete','execute'],enforcement:{request:true,commit:true},public:false},
  {id:'view',title:'Consulter le catalogue publié',audiences:['admin','app'],
    actors:['user','delegated-user','machine'],scopes:['catalog.view'],context:'required',default:'deny',
    resources:[ref('model','category'),ref('model','product'),ref('model','product_media'),
      ref('model','file_metadata'),ref('file','images')],
    actions:['read','execute'],enforcement:{request:true,commit:true},public:false}];
const errors=['invalid_input','unauthorized','forbidden','not_found','conflict','rate_limited','unavailable','unknown']
  .map(code=>({code,retryable:['rate_limited','unavailable','unknown'].includes(code),
    outcome:code==='unknown'?'unknown':'rejected'}));
const operations=[];
function operation(name,title,kind,input,output,reads,writes,options={}){
  const command=kind==='command',view=options.view===true;
  operations.push({id:name,title,kind,input,output,permissions:[ref('permission',view?'view':'manage')],
    audiences:view?['admin','app']:['admin'],actors:['user','delegated-user','machine'],context:'required',
    handler:{path:'module/operations.ts',export:options.exportName},
    effects:{reads:reads.map(name=>ref('model',name)),writes:writes.map(name=>ref('model',name)),
      emits:[],calls:[],providers:[]},errors,pagination:options.pagination??{mode:'none'},
    idempotency:command?{mode:'required',keyField:'requestKey',scope:'actor-context-operation',
      retentionSeconds:86400}:{mode:'none'},approval:{mode:'none'},
    concurrency:options.cas?{mode:'object-version',versionField:'revision'}:{mode:'none'},
    execution:{maxDurationMs:10000,maxItems:options.maxItems??100,resumable:false},
    audit:{required:true,redactFields:['description','attributes']},public:options.public===true});
}
const catPage={mode:'cursor',cursorField:'cursor',limitField:'limit',maxItems:50};
const prodPage={mode:'cursor',cursorField:'cursor',limitField:'limit',maxItems:25};
operation('category.create','Créer une catégorie','command',categoryCreateInput,categoryOutput,
  ['category'],['category'],{exportName:'categoryCreate'});
operation('category.update','Modifier une catégorie','command',categoryUpdateInput,categoryOutput,
  ['category'],['category'],{exportName:'categoryUpdate',cas:true});
operation('category.archive','Archiver une catégorie vide','command',stateInput,categoryOutput,
  ['category','product'],['category'],{exportName:'categoryArchive',cas:true});
operation('category.list','Lister les catégories','query',categoryListInput,categoryListOutput,
  ['category'],[],{exportName:'categoryList',view:true,public:true,pagination:catPage,maxItems:500});
operation('product.create','Créer un brouillon produit','command',productCreateInput,productOutput,
  ['category'],['category','product'],{exportName:'productCreate'});
operation('product.update','Modifier un produit','command',productUpdateInput,productOutput,
  ['product','category'],['product','category'],{exportName:'productUpdate'});
operation('product.publish','Publier un produit','command',stateInput,productOutput,
  ['product','category'],['product','category'],{exportName:'productPublish',cas:true});
operation('product.archive','Archiver un produit','command',stateInput,productOutput,
  ['product'],['product'],{exportName:'productArchive',cas:true});
operation('product.list','Lister les produits en édition','query',productListInput,productListOutput,
  ['product'],[],{exportName:'productList',pagination:prodPage,maxItems:500});
operation('product.read','Lire un produit en édition','query',productInput,productOutput,
  ['product'],[],{exportName:'productRead'});
operation('product.search','Rechercher les produits publiés','query',productSearchInput,productSearchOutput,
  ['product'],[],{exportName:'productSearch',view:true,public:true,pagination:prodPage,maxItems:500});
operation('product.get','Lire un produit publié','query',productInput,publishedOutput,
  ['product'],[],{exportName:'productGet',view:true,public:true});
operation('media.list','Lister les médias liés','query',mediaListInput,mediaListOutput,
  ['product','product_media'],[],{exportName:'mediaList',view:true,maxItems:10});
operation('media.link','Lier une image privée','command',mediaLinkInput,mediaLinkOutput,
  ['product','product_media'],['product','product_media'],{exportName:'mediaLink',cas:true,maxItems:20});
operations.at(-1).effects.writes.push(ref('file','images'));
operation('media.unlink','Détacher une image','command',mediaUnlinkInput,mediaUnlinkOutput,
  ['product','product_media'],['product','product_media'],{exportName:'mediaUnlink',maxItems:20});
const file={id:'images',metadataModel:ref('model','file_metadata'),contextField:'context_id',
  ownerField:'file_owner',ownerScope:'principal',storageFields:{id:'file_id',objectKey:'object_key',
    digest:'digest',byteSize:'byte_size',contentType:'content_type',filename:'filename',version:'version',
    state:'state',intentId:'intent_id',generation:'generation'},
  mimeTypes:['image/png','image/jpeg','image/webp'],maxBytes:2*1024*1024,public:false,
  permissions:[ref('permission','manage')],attachment:{models:[ref('model','product')],multiple:true},
  deletion:'restrict',linkedRead:{audiences:['app'],permission:ref('permission','view'),
    linkModel:ref('model','product_media'),parentRelation:'product',
    referenceFields:{fileId:'file_id',intentId:'intent_id',generation:'generation',digest:'digest'},
    when:{field:'status',equals:'published'}}};
const api=[];
for(const op of operations)for(const audience of op.audiences){
  const spec=schemas.find(item=>item.id===op.input.schemaId).schema;
  api.push({id:`${audience}.${op.id}`,method:op.kind==='command'?'POST':'GET',
    path:`/api/${audience}/catalog/${op.id.replaceAll('.','/')}`,operation:ref('operation',op.id),
    audience,auth:['session','oauth','api-token'],parameters:op.kind==='command'?[]:
      Object.entries(spec.properties).filter(([,value])=>['string','integer','boolean'].includes(value.type))
        .map(([name])=>({name:name.replaceAll(/[A-Z]/g,c=>'_'+c.toLowerCase()),in:'query',inputField:name,
          required:spec.required.includes(name)})),input:op.input,output:op.output,
    rateLimit:{requests:60,windowSeconds:60}});
}
const widgetResource=(name)=>({id:`${name}-ui`,uri:`ui://${id}/${name}`,
  mimeType:'text/html;profile=mcp-app',audiences:['admin','app'],permissions:[ref('permission','view')],
  source:{kind:'asset',path:`ui/widgets/${name}.html`},widget:ref('widget',name),
  ui:{csp:{connectDomains:[],resourceDomains:[],frameDomains:[],baseUriDomains:[]},
    permissions:{},prefersBorder:true}});
const widget=(name,output,readInput,readOp,renderer)=>({id:name,version:'1.0.0',compatibility:'^1.0.0',
  resource:`${name}-ui`,renderer:{path:`ui/widgets/${name}.ts`,export:renderer},input:output,
  state:widgetState,result:output,audiences:['admin','app'],permissions:[ref('permission','view')],
  requiredCapabilities:[],assets:[],actions:[{id:'refresh',label:'Actualiser',input:readInput,
    requiredCapabilities:[],fallback:'unavailable',mode:'direct',target:{kind:'operation',
      operation:ref('operation',readOp)}}],
  instance:{identity:'host-generated',revision:'monotonic',correlation:'request-instance-conversation',
    objectVersion:'distinct',lateResponse:'reject-stale'},
  transport:{protocol:'mcp-apps',maxPayloadBytes:65536,timeoutMs:15000,
    uncertainResult:'reconcile-before-retry',fallbackDispatch:'before-first-dispatch-only'}});
const m=structuredClone(template),skillPath='plugin/skills/catalog.md';
const skillIntegrity=`sha256-${createHash('sha256').update(readFileSync(new URL(skillPath,root))).digest('hex')}`;
m.identity={id,title:'Catalogue métier',publisher:'creezio',origin:'https://github.com/creezio/Creezio-D1R2',
  version,source:{kind:'snapshot',revision,
    integrity:`sha256-${createHash('sha256').update(revision).digest('hex')}`},
  license:{expression:'NOASSERTION',file:'LICENSE'}};
m.compatibility={core:'^0.0.0',sdk:'^1.3.0',
  requiredCapabilities:['runtime.worker','data.d1.shared','files.r2.shared'],optionalCapabilities:[]};
m.entrypoints={server:{path:'module/entry.server.ts',export:'catalog'},
  ui:{path:'ui/index.tsx',export:'CatalogAdminView'},
  plugin:{manifest:'plugin/plugin.json',mcp:'plugin/mcp.json',
    contributions:{path:'plugin/contributions.ts',export:'contributions'}}};
m.dependencies=[{moduleId:'creezio.access',origin:'https://github.com/creezio/Creezio-D1R2',
  versionRange:'^0.0.0',optional:false,contracts:[],whenAbsent:'block',whenIncompatible:'block',autoInstall:false}];
const mcpTools=operations.map(op=>({id:op.id,name:`catalog_${op.id.replaceAll('.','_')}`,
  operation:ref('operation',op.id),audiences:op.audiences,auth:['oauth','api-token'],input:op.input,output:op.output,
  annotations:{readOnly:op.kind==='query',destructive:op.id.endsWith('.archive')||op.id==='media.unlink',
    idempotent:op.kind==='query',openWorld:false},
  ...(op.id==='product.search'?{widget:ref('widget','product-list')}:
    op.id==='product.get'?{widget:ref('widget','product-detail')}:{ }),textFallback:true}));
m.contracts={schemas,models,files:[file],events:[],settings:[],search:[],permissions,operations,api,
  mcp:{tools:mcpTools,resources:[widgetResource('product-list'),widgetResource('product-detail')],prompts:[],
    skills:[{id:'catalog',path:skillPath,audiences:['admin','app'],operations:[ref('operation','product.search'),
      ref('operation','product.get'),ref('operation','category.list')],
      resources:['product-list-ui','product-detail-ui'],integrity:skillIntegrity}]},
  ui:{views:[{id:'admin',title:'Catalogue',surfaces:['workspace'],route:'/admin/catalog',
    component:{path:'ui/index.tsx',export:'CatalogAdminView'},permissions:[ref('permission','manage')],
    operations:operations.filter(op=>op.audiences.includes('admin')).map(op=>ref('operation',op.id)),
    input:viewInput,panel:{identityFields:[],navigation:'sdk',retention:'preserve',inactiveEffects:'suspend',
      stateSchema:panelState}},
    {id:'front',title:'Catalogue',surfaces:['front'],route:'/catalog',
      component:{path:'ui/front.tsx',export:'CatalogFrontView'},permissions:[ref('permission','view')],
      operations:operations.filter(op=>op.permissions[0].id==='view').map(op=>ref('operation',op.id)),
      input:viewInput,panel:{identityFields:[],navigation:'sdk',retention:'preserve',inactiveEffects:'suspend',
        stateSchema:panelState}}],navigation:[{id:'catalog-admin',title:'Catalogue',view:ref('view','admin'),
      permissions:[ref('permission','manage')],surfaces:['workspace'],order:65},
      {id:'catalog-front',title:'Catalogue',view:ref('view','front'),
        permissions:[ref('permission','view')],surfaces:['front'],order:65}],
    slots:[],front:{mode:'provided'},themes:[],styles:[]},
  widgets:[widget('product-list',productSearchOutput,productSearchInput,'product.search','startProductList'),
    widget('product-detail',publishedOutput,productInput,'product.get','startProductDetail')],
  publicContracts:[{id:'catalog.products',version:'1.0.0',models:[],
    operations:[ref('operation','product.search'),ref('operation','product.get'),ref('operation','category.list')],
    events:[],schemas:[productSearchInput,productSearchOutput,productInput,publishedOutput,
      categoryListInput,categoryListOutput]}]};
m.documentation.versionBinding={moduleVersion:version,sourceRevision:revision};
for(const suite of ['backend','ui','api-mcp','widgets','package','docs'])
  m.validation.suites[suite].tests=[`tests/${suite}/contract.test.mjs`];
m.validation.suites.widgets.mode='required';delete m.validation.suites.widgets.justification;
m.packaging.runtime.files=['module/manifest.json','module/models.json','module/entry.server.ts',
  'module/operations.ts','module/service.ts','module/public-contract.ts',
  'ui/index.tsx','ui/front.tsx','ui/contracts.ts','ui/money.ts','ui/panel-state.ts','ui/session.ts',
  'ui/image-gate.ts',
  'ui/widgets/runtime.ts','ui/widgets/product-list.ts','ui/widgets/product-detail.ts',
  'ui/widgets/product-list.html','ui/widgets/product-detail.html',
  'README.md','prd.md','CHANGELOG.md','LICENSE','plugin/plugin.json','plugin/mcp.json',
  'plugin/contributions.ts',skillPath];
m.packaging.validation.files=['AGENTS.md','FILES.md','interview.md','TODO.md','gate.mjs',
  'module/generate-manifest.mjs','ci/run-suite.mjs','tests/helpers.mjs',
  ...['backend','ui','api-mcp','widgets','package','docs']
    .flatMap(name=>[`ci/${name}.mjs`,`tests/${name}/contract.test.mjs`])];
m.packaging.validationBinding={moduleId:id,moduleVersion:version,sourceRevision:revision};
m.lifecycle.absent={};m.lifecycle.configuration='explicit-state';
writeFileSync(new URL('module/models.json',root),JSON.stringify(models,null,2)+'\n');
writeFileSync(new URL('module/manifest.json',root),JSON.stringify(m,null,2)+'\n');
