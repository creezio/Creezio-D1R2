import {OperationError,type JsonValue} from '@creezio/sdk/operations/handler';

export type Collection='customers'|'subscriptions'|'invoices'|'products'|'prices_active'|'prices_inactive';
export type Projection=Readonly<{id:string;values:Readonly<Record<string,JsonValue>>}>;
const prefix:Record<Collection,string>={customers:'cus_',subscriptions:'sub_',invoices:'in_',
  products:'prod_',prices_active:'price_',prices_inactive:'price_'};
const fail=():never=>{throw new OperationError('unavailable');};
const object=(value:unknown):Record<string,unknown>=>
  value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:fail();
const bounded=(value:unknown,max:number):string=>{
  if(typeof value!=='string'||!value.isWellFormed()||value.length>max
    ||new TextEncoder().encode(value).length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value))return fail();
  return value;
};
const id=(value:unknown,expected?:string):string=>{
  const text=bounded(value,128);
  if(!text||!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(text)||expected&&!text.startsWith(expected))return fail();
  return text;
};
const optional=(value:unknown,max:number):string|null=>value===null?null:bounded(value,max);
const currency=(value:unknown):string=>{
  const text=bounded(value,3).toUpperCase();
  if(!/^[A-Z]{3}$/u.test(text))return fail();
  return text;
};
const amount=(value:unknown):number=>Number.isSafeInteger(value)?Number(value):fail();
const timestamp=(value:unknown):string|null=>{
  if(value===null)return null;
  if(!Number.isSafeInteger(value)||Number(value)<0||Number(value)>8_640_000_000_000)return fail();
  const date=new Date(Number(value)*1000);
  if(Number.isNaN(date.valueOf()))return fail();
  return date.toISOString();
};
const put=(out:Record<string,JsonValue>,source:Record<string,unknown>,from:string,to:string,
  parse:(value:unknown)=>JsonValue)=>{
  if(Object.hasOwn(source,from))out[to]=parse(source[from]);
};

function customer(raw:Record<string,unknown>):Record<string,JsonValue>{
  if(typeof raw.livemode!=='boolean')return fail();
  const result:Record<string,JsonValue>={livemode:raw.livemode,name:null};
  put(result,raw,'name','name',value=>optional(value,160));
  return result;
}
function subscription(raw:Record<string,unknown>):Record<string,JsonValue>{
  if(typeof raw.livemode!=='boolean')return fail();
  const result:Record<string,JsonValue>={livemode:raw.livemode,
    customer_id:id(raw.customer,'cus_'),status:bounded(raw.status,64),currency:null,
    price_id:null,unit_amount_minor:null,interval:null,interval_count:null,quantity:null,
    cancel_at_period_end:null,period_end_at:null};
  if(!result.status)return fail();
  if(raw.cancel_at_period_end!==undefined){
    if(typeof raw.cancel_at_period_end!=='boolean')return fail();
    result.cancel_at_period_end=raw.cancel_at_period_end;
  }
  put(result,raw,'currency','currency',value=>value===null?null:currency(value));
  if(Object.hasOwn(raw,'items')){
    const items=object(raw.items),data=items.data;
    if(!Array.isArray(data)||typeof items.has_more!=='boolean')return fail();
    // A complex or incomplete price cannot be presented as one monthly charge.
    if(!items.has_more&&data.length===1){
      const item=object(data[0]),price=item.price===null?null:object(item.price);
      if(price){
        result.price_id=id(price.id,'price_');
        if(price.unit_amount!==null&&price.unit_amount!==undefined)
          result.unit_amount_minor=amount(price.unit_amount);
        if(price.currency!==undefined&&price.currency!==null)result.currency=currency(price.currency);
        const recurring=price.recurring===null||price.recurring===undefined?null:object(price.recurring);
        if(recurring){
          result.interval=bounded(recurring.interval,32);
          result.interval_count=amount(recurring.interval_count);
        }
      }
      if(item.quantity!==null&&item.quantity!==undefined)result.quantity=amount(item.quantity);
      put(result,item,'current_period_end','period_end_at',timestamp);
    }
  }
  return result;
}
function invoice(raw:Record<string,unknown>):Record<string,JsonValue>{
  if(typeof raw.livemode!=='boolean')return fail();
  const result:Record<string,JsonValue>={livemode:raw.livemode,
    currency:currency(raw.currency),amount_due_minor:amount(raw.amount_due),customer_id:null,
    status:null,period_start_at:null,period_end_at:null};
  put(result,raw,'customer','customer_id',value=>value===null?null:id(value,'cus_'));
  put(result,raw,'status','status',value=>optional(value,64));
  put(result,raw,'period_start','period_start_at',timestamp);
  put(result,raw,'period_end','period_end_at',timestamp);
  return result;
}
function product(raw:Record<string,unknown>):Record<string,JsonValue>{
  if(typeof raw.active!=='boolean'||typeof raw.livemode!=='boolean')return fail();
  const name=bounded(raw.name,500);
  if(!name)return fail();
  const defaultPrice=raw.default_price===null?null:id(raw.default_price,'price_');
  return {name,active:raw.active,default_price_id:defaultPrice,livemode:raw.livemode};
}
function price(raw:Record<string,unknown>,collection:'prices_active'|'prices_inactive'):
    Record<string,JsonValue>{
  if(typeof raw.active!=='boolean'||raw.active!==(collection==='prices_active')||
    typeof raw.livemode!=='boolean')return fail();
  const kind=bounded(raw.type,32),scheme=bounded(raw.billing_scheme,32);
  if(!['one_time','recurring'].includes(kind)||!['per_unit','tiered'].includes(scheme))return fail();
  const recurring=raw.recurring===null?null:object(raw.recurring);
  if((kind==='recurring')!==!!recurring)return fail();
  const interval=recurring?bounded(recurring.interval,16):null;
  const intervalCount=recurring?amount(recurring.interval_count):null;
  const usageType=recurring?bounded(recurring.usage_type,16):null;
  if(interval&&!['day','week','month','year'].includes(interval)||
    intervalCount!==null&&intervalCount<1||usageType&&!['licensed','metered'].includes(usageType))return fail();
  const minor=raw.unit_amount===null?null:amount(raw.unit_amount);
  if(minor!==null&&minor<0)return fail();
  const decimal=raw.unit_amount_decimal===null?null:bounded(raw.unit_amount_decimal,64);
  if(decimal!==null&&!/^(?:0|[1-9]\d*)(?:\.\d{1,12})?$/u.test(decimal))return fail();
  const tiers=raw.tiers_mode===null?null:bounded(raw.tiers_mode,16);
  if(tiers!==null&&!['graduated','volume'].includes(tiers))return fail();
  const custom=raw.custom_unit_amount!==null;
  if(custom&&(!raw.custom_unit_amount||typeof raw.custom_unit_amount!=='object'||
    Array.isArray(raw.custom_unit_amount)))return fail();
  return {product_id:id(raw.product,'prod_'),active:raw.active,livemode:raw.livemode,
    currency:currency(raw.currency),type:kind,billing_scheme:scheme,
    unit_amount_minor:minor,unit_amount_decimal:decimal,interval,
    interval_count:intervalCount,usage_type:usageType,tiers_mode:tiers,custom_amount:custom};
}

/** Rejects the whole remote page before any D1 projection plan is issued. */
export function projectStripePage(body:JsonValue,collection:Collection,limit:number){
  const response=object(body);
  if(response.object!=='list'||!Array.isArray(response.data)||response.data.length>limit
    ||typeof response.has_more!=='boolean'||response.has_more&&response.data.length===0)return fail();
  const seen=new Set<string>(),rows:Projection[]=[];
  for(const value of response.data){
    const item=object(value),stripeId=id(item.id,prefix[collection]);
    const expected=collection.startsWith('prices_')?'price':collection.slice(0,-1);
    if(item.object!==expected||seen.has(stripeId))return fail();
    seen.add(stripeId);
    const values=collection==='customers'?customer(item):
      collection==='subscriptions'?subscription(item):collection==='invoices'?invoice(item):
        collection==='products'?product(item):price(item,collection);
    const row={id:stripeId,values};
    if(new TextEncoder().encode(JSON.stringify(row)).length>16_384)return fail();
    rows.push(row);
  }
  if(new TextEncoder().encode(JSON.stringify(rows)).length>196_608)return fail();
  return {rows,nextCursor:response.has_more?rows.at(-1)!.id:null,
    status:response.has_more?'partial' as const:'pages_exhausted' as const};
}
