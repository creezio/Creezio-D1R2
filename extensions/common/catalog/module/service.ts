import {OperationError,type OperationContext,type JsonValue} from '@creezio/sdk/operations/handler';

type Row=Record<string,JsonValue>;
type Args=Record<string,unknown>;
type Page={items:readonly Row[];nextAfter:Row|null};
type ProductStatus='draft'|'published'|'archived';
const statuses:readonly ProductStatus[]=['draft','published','archived'];
const fail=(code:'invalid_input'|'conflict'|'not_found'|'forbidden'|'unavailable'):never=>{throw new OperationError(code);};
const args=(value:JsonValue):Args=>value&&typeof value==='object'&&!Array.isArray(value)?value as Args:{};
const id=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value);
const sku=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/u.test(value);
const slug=(value:unknown):value is string=>typeof value==='string'&&/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value)&&value.length<=80;
const text=(value:unknown,max:number,required=false):value is string=>typeof value==='string'&&value.length<=max
  &&value.isWellFormed()&&(!required||value.trim().length>0);
const integer=(value:unknown,min:number,max:number):value is number=>Number.isSafeInteger(value)
  &&Number(value)>=min&&Number(value)<=max;
const key=(id:string)=>({id});
const now=()=>new Date().toISOString();
const categoryView=(row:Row)=>({id:row.id,name:row.name,slug:row.slug,parentId:row.parent_id,
  position:row.position,archivedAt:row.archived_at,revision:row.revision,
  createdAt:row.created_at,updatedAt:row.updated_at});
const productView=(row:Row)=>({id:row.id,sku:row.sku,name:row.name,description:row.description,
  attributes:row.attributes,categoryId:row.category_id,priceMinor:row.price_minor,currency:row.currency,
  status:row.status,revision:row.revision,createdAt:row.created_at,updatedAt:row.updated_at});
const productSummary=(row:Row)=>({id:row.id,sku:row.sku,name:row.name,categoryId:row.category_id,
  priceMinor:row.price_minor,currency:row.currency,status:row.status,revision:row.revision,
  updatedAt:row.updated_at});
const mediaView=(row:Row)=>({productId:row.product_id,fileId:row.file_id,filename:row.filename,
  contentType:row.content_type,byteSize:row.byte_size,digest:row.digest,createdAt:row.created_at,
  reference:{fileId:row.file_id,intentId:row.intent_id,generation:row.generation,digest:row.digest}});
const mediaKey=(productId:string,fileId:string)=>({product_id:productId,file_id:fileId});
async function record(c:OperationContext,model:'category'|'product',value:unknown):Promise<Row>{
  if(!id(value))fail('invalid_input');
  const row=await c.data.get(model,{key:key(value as string)}) as Row|null;
  return row??fail('not_found');
}
async function liveCategory(c:OperationContext,value:unknown):Promise<Row>{
  const row=await record(c,'category',value);
  if(row.archived_at!==null)fail('conflict');
  return row;
}
function productFields(input:Args):Row{
  if(!sku(input.sku)||!text(input.name,160,true)||!text(input.description,1200)
    ||input.categoryId!==null&&!id(input.categoryId)
    ||!integer(input.priceMinor,0,1_000_000_000_000)
    ||typeof input.currency!=='string'||!/^[A-Z]{3}$/u.test(input.currency)
    ||!Array.isArray(input.attributes)||input.attributes.length>12)fail('invalid_input');
  const keys=new Set<string>();
  const attributes=[];
  for(const item of input.attributes as unknown[]){
    if(!item||typeof item!=='object'||Array.isArray(item))fail('invalid_input');
    const part=item as Record<string,unknown>;
    if(Object.keys(part).sort().join(',')!=='key,value'||!id(part.key)||String(part.key).length>64
      ||!text(part.value,160)||keys.has(part.key))fail('invalid_input');
    keys.add(part.key as string);attributes.push({key:part.key as string,value:part.value as string});
  }
  return {sku:input.sku,name:(input.name as string).trim(),description:input.description,
    category_id:input.categoryId,price_minor:input.priceMinor,currency:input.currency,
    attributes} as Row;
}
function categoryFields(input:Args):Row{
  if(!text(input.name,120,true)||!slug(input.slug)||!integer(input.position,0,100_000))fail('invalid_input');
  return {name:(input.name as string).trim(),slug:input.slug as string,position:input.position as number};
}
function limit(value:unknown,max=50):number{
  if(!integer(value,1,max))fail('invalid_input');
  return value as number;
}
function query(value:unknown):string{
  if(value===undefined)return '';
  if(!text(value,120))fail('invalid_input');
  const clean=(value as string).trim().toLocaleLowerCase();
  if(clean.length>120||/[\u0000-\u001f\u007f]/u.test(clean))fail('invalid_input');
  return clean;
}
function decode(value:unknown,scope:Record<string,unknown>,fields:readonly string[]):Row|null{
  if(value===undefined||value===null)return null;
  if(typeof value!=='string'||value.length>2048)fail('invalid_input');
  try{
    const parsed=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(
      atob((value as string).replaceAll('-','+').replaceAll('_','/')),letter=>letter.charCodeAt(0))));
    if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)||parsed.v!==1
      ||Object.entries(scope).some(([name,part])=>parsed[name]!==part)
      ||!parsed.after||typeof parsed.after!=='object'||Array.isArray(parsed.after))throw 0;
    const after=parsed.after as Row;
    if(Object.keys(after).sort().join(',')!==[...fields].sort().join(',')
      ||!fields.every(name=>name==='id'?id(after[name]):
        name==='position'?integer(after[name],0,100_000):
          typeof after[name]==='string'&&after[name].length<=35))throw 0;
    return after;
  }catch{return fail('invalid_input');}
}
function encode(after:Row|null,scope:Record<string,unknown>):string|null{
  if(!after)return null;
  return btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify({v:1,...scope,after}))))
    .replaceAll('+','-').replaceAll('/','_').replace(/=+$/u,'');
}
async function linkedCategoryPlans(c:OperationContext,categoryId:unknown){
  if(categoryId===null)return [];
  const row=await liveCategory(c,categoryId),at=now();
  return [c.data.planGet('category',{key:key(String(categoryId)),where:{archived_at:null},required:true}),
    c.data.planPatch('category',{key:key(String(categoryId)),compare:{field:'revision',expected:Number(row.revision)},
      where:{archived_at:null},values:{updated_at:at}})];
}
export async function categoryCreate(value:JsonValue,c:OperationContext){
  const input=args(value),fields=categoryFields(input);
  if(input.parentId!==null&&!id(input.parentId))fail('invalid_input');
  let plans:ReturnType<typeof c.data.planGet>[]=[];
  if(input.parentId!==null){const parent=await liveCategory(c,input.parentId);
    if(parent.parent_id!==null)fail('conflict');
    plans=[c.data.planGet('category',{key:key(String(input.parentId)),where:{archived_at:null,parent_id:null},required:true}),
      c.data.planPatch('category',{key:key(String(input.parentId)),compare:{field:'revision',
        expected:Number(parent.revision)},where:{archived_at:null,parent_id:null},values:{updated_at:now()}})];}
  const at=now(),row:Row={id:crypto.randomUUID(),...fields,parent_id:input.parentId as string|null,
    archived_at:null,revision:1,created_at:at,updated_at:at};
  return {output:{category:categoryView(row)},plans:[...plans,c.data.planCreate('category',{values:row})]};
}
export async function categoryUpdate(value:JsonValue,c:OperationContext){
  const input=args(value),row=await record(c,'category',input.id),revision=Number(input.revision);
  if(row.archived_at!==null||!integer(revision,1,Number.MAX_SAFE_INTEGER)||revision!==row.revision)fail('conflict');
  const fields=categoryFields(input),patch={...fields,updated_at:now()};
  return {output:{category:categoryView({...row,...patch,revision:revision+1})},plans:[
    c.data.planPatch('category',{key:key(String(input.id)),compare:{field:'revision',expected:revision},
      where:{archived_at:null},values:patch})]};
}
export async function categoryArchive(value:JsonValue,c:OperationContext){
  const input=args(value),row=await record(c,'category',input.id),revision=Number(input.revision);
  if(row.archived_at!==null||!integer(revision,1,Number.MAX_SAFE_INTEGER)||revision!==row.revision)fail('conflict');
  for(const [model,where] of [['category',{parent_id:row.id}],['product',{category_id:row.id}]] as const){
    const children=await c.data.list(model,{limit:1,where});
    if(children.items.length)fail('conflict');
  }
  const patch={archived_at:now(),updated_at:now()};
  return {output:{category:categoryView({...row,...patch,revision:revision+1})},plans:[
    c.data.planPatch('category',{key:key(String(input.id)),compare:{field:'revision',expected:revision},
      where:{archived_at:null},values:patch})]};
}
export async function categoryList(value:JsonValue,c:OperationContext){
  const input=args(value),n=limit(input.limit),includeArchived=input.includeArchived===true;
  if(input.includeArchived!==undefined&&typeof input.includeArchived!=='boolean')fail('invalid_input');
  if(c.audience==='app'&&includeArchived)fail('forbidden');
  const scope={context:c.contextId,audience:c.audience,includeArchived};
  let after=decode(input.cursor,scope,['position','id']),scanned=0,complete=false;
  const items:ReturnType<typeof categoryView>[]=[];
  for(let page=0;page<10&&scanned<500&&items.length<n;page++){
    const part=await c.data.list('category',{limit:50,after,
      fields:['id','name','slug','parent_id','position','archived_at','revision','created_at','updated_at'],
      order:{indexId:'by-position',direction:'asc'}}) as Page;
    let last:Row|null=null;
    for(const row of part.items){last=row;scanned++;
      if(includeArchived||row.archived_at===null)items.push(categoryView(row));
      if(items.length===n)break;
    }
    const exhausted=last===part.items.at(-1)&&!part.nextAfter;
    after=items.length===n&&last&&!exhausted?{position:last.position,id:last.id}:part.nextAfter;
    if(!after){complete=true;break;}
  }
  return {output:{items,nextCursor:encode(after,scope),complete,scanned}};
}
export async function productCreate(value:JsonValue,c:OperationContext){
  const input=args(value),fields=productFields(input),plans=await linkedCategoryPlans(c,input.categoryId);
  const at=now(),row:Row={id:crypto.randomUUID(),...fields,status:'draft',revision:1,
    created_at:at,updated_at:at};
  return {output:{product:productView(row)},plans:[...plans,c.data.planCreate('product',{values:row})]};
}
export async function productUpdate(value:JsonValue,c:OperationContext){
  const input=args(value),row=await record(c,'product',input.id),revision=Number(input.revision);
  if(row.status==='archived'||!integer(revision,1,Number.MAX_SAFE_INTEGER)||revision!==row.revision)fail('conflict');
  const fields=productFields(input),plans=fields.category_id!==row.category_id?
    await linkedCategoryPlans(c,input.categoryId):[];
  const patch={...fields,updated_at:now()};
  return {output:{product:productView({...row,...patch,revision:revision+1})},plans:[...plans,
    c.data.planPatch('product',{key:key(String(input.id)),compare:{field:'revision',expected:revision},
      where:{status:row.status},values:patch})]};
}
export async function productPublish(value:JsonValue,c:OperationContext){
  const input=args(value),row=await record(c,'product',input.id),revision=Number(input.revision);
  if(row.status!=='draft'||!integer(revision,1,Number.MAX_SAFE_INTEGER)||revision!==row.revision)fail('conflict');
  const patch={status:'published',updated_at:now()};
  return {output:{product:productView({...row,...patch,revision:revision+1})},plans:[
    c.data.planPatch('product',{key:key(String(input.id)),compare:{field:'revision',expected:revision},
      where:{status:'draft'},values:patch})]};
}
export async function productArchive(value:JsonValue,c:OperationContext){
  const input=args(value),row=await record(c,'product',input.id),revision=Number(input.revision);
  if(row.status==='archived'||!integer(revision,1,Number.MAX_SAFE_INTEGER)||revision!==row.revision)fail('conflict');
  const patch={status:'archived',updated_at:now()};
  return {output:{product:productView({...row,...patch,revision:revision+1})},plans:[
    c.data.planPatch('product',{key:key(String(input.id)),compare:{field:'revision',expected:revision},
      where:{status:row.status},values:patch})]};
}
export async function productRead(value:JsonValue,c:OperationContext){
  const row=await record(c,'product',args(value).id);
  return {output:{product:productView(row)}};
}
export async function productGet(value:JsonValue,c:OperationContext){
  const row=await record(c,'product',args(value).id);
  if(row.status!=='published')fail('not_found');
  return {output:{product:productView(row)}};
}
const productFieldsList=['id','sku','name','category_id','price_minor','currency','status',
  'revision','updated_at'] as const;
async function products(value:JsonValue,c:OperationContext,publishedOnly:boolean){
  const input=args(value),n=limit(input.limit,25),search=query(input.query),
    categoryId=input.categoryId===undefined?null:input.categoryId;
  if(categoryId!==null&&!id(categoryId))fail('invalid_input');
  const status=publishedOnly?'published':input.status===undefined?null:input.status;
  if(status!==null&&!statuses.includes(status as ProductStatus))fail('invalid_input');
  const scope={context:c.contextId,audience:c.audience,publishedOnly,query:search,categoryId,status};
  let after=decode(input.cursor,scope,['updated_at','id']),scanned=0,complete=false;
  const items:ReturnType<typeof productSummary>[]=[];
  for(let page=0;page<10&&scanned<500&&items.length<n;page++){
    const part=await c.data.list('product',{limit:50,after,fields:productFieldsList,
      order:{indexId:'by-updated',direction:'desc'}}) as Page;
    let last:Row|null=null;
    for(const row of part.items){last=row;scanned++;
      if((status===null||row.status===status)&&(categoryId===null||row.category_id===categoryId)
        &&(!search||[row.sku,row.name].some(part=>typeof part==='string'
          &&part.toLocaleLowerCase().includes(search))))items.push(productSummary(row));
      if(items.length===n)break;
    }
    const exhausted=last===part.items.at(-1)&&!part.nextAfter;
    after=items.length===n&&last&&!exhausted?{updated_at:last.updated_at,id:last.id}:part.nextAfter;
    if(!after){complete=true;break;}
  }
  return {output:{items,nextCursor:encode(after,scope),complete,scanned}};
}
export const productList=(value:JsonValue,c:OperationContext)=>products(value,c,false);
export const productSearch=(value:JsonValue,c:OperationContext)=>products(value,c,true);
export async function mediaList(value:JsonValue,c:OperationContext){
  const input=args(value),parent=await record(c,'product',input.productId);
  if(c.audience==='app'&&parent.status!=='published')fail('not_found');
  const result=await c.data.list('product_media',{limit:6,where:{product_id:parent.id},
    order:{indexId:'by-product',direction:'desc'}}) as Page;
  return {output:{items:result.items.map(mediaView)}};
}
export async function mediaLink(value:JsonValue,c:OperationContext){
  const input=args(value),parent=await record(c,'product',input.productId),revision=Number(input.revision);
  if(parent.status==='archived'||!integer(revision,1,Number.MAX_SAFE_INTEGER)||revision!==parent.revision)fail('conflict');
  const existing=await c.data.list('product_media',{limit:6,where:{product_id:parent.id},
    order:{indexId:'by-product',direction:'desc'}}) as Page;
  if(existing.items.length>=5)fail('conflict');
  if(!input.staged||typeof input.staged!=='object'||Array.isArray(input.staged)||!c.files)fail('invalid_input');
  const staged=input.staged as {fileId:string;intentId:string;generation:string;digest:string};
  const prepared=await c.files!.preparePublication('images',staged),at=now();
  const row:Row={product_id:parent.id,file_id:staged.fileId,filename:prepared.file.filename,
    content_type:prepared.file.contentType,byte_size:prepared.file.byteSize,digest:staged.digest,
    intent_id:staged.intentId,generation:staged.generation,created_at:at};
  return {output:{media:mediaView(row),product:productView({...parent,revision:revision+1,updated_at:at})},plans:[
    prepared.plan,c.data.planGet('product',{key:key(String(parent.id)),where:{status:parent.status},required:true}),
    c.data.planCreate('product_media',{values:row}),
    c.data.planPatch('product',{key:key(String(parent.id)),compare:{field:'revision',expected:revision},
      where:{status:parent.status},values:{updated_at:at}})]};
}
export async function mediaUnlink(value:JsonValue,c:OperationContext){
  const input=args(value),parent=await record(c,'product',input.productId),revision=Number(input.revision);
  if(!id(input.fileId)||parent.status==='archived'||!integer(revision,1,Number.MAX_SAFE_INTEGER)
    ||revision!==parent.revision)fail('conflict');
  const linked=await c.data.get('product_media',{key:mediaKey(String(parent.id),input.fileId as string)}) as Row|null;
  if(!linked)fail('not_found');
  const at=now();
  return {output:{removed:true,product:productView({...parent,revision:revision+1,updated_at:at})},plans:[
    c.data.planDelete('product_media',{key:mediaKey(String(parent.id),input.fileId as string)}),
    c.data.planPatch('product',{key:key(String(parent.id)),compare:{field:'revision',expected:revision},
      where:{status:parent.status},values:{updated_at:at}})]};
}
