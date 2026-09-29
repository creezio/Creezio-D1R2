import {OperationError,type JsonValue} from '@creezio/sdk/operations/handler';

export type Collection='customers'|'subscriptions'|'invoices';
export type Projection=Readonly<{id:string;values:Readonly<Record<string,JsonValue>>}>;
const prefix:Record<Collection,string>={customers:'cus_',subscriptions:'sub_',invoices:'in_'};
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
    price_id:null,unit_amount_minor:null,interval:null,interval_count:null,quantity:null,period_end_at:null};
  if(!result.status)return fail();
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

/** Rejects the whole remote page before any D1 projection plan is issued. */
export function projectStripePage(body:JsonValue,collection:Collection,limit:number){
  const response=object(body);
  if(response.object!=='list'||!Array.isArray(response.data)||response.data.length>limit
    ||typeof response.has_more!=='boolean'||response.has_more&&response.data.length===0)return fail();
  const seen=new Set<string>(),rows:Projection[]=[];
  for(const value of response.data){
    const item=object(value),stripeId=id(item.id,prefix[collection]);
    if(item.object!==collection.slice(0,-1)||seen.has(stripeId))return fail();
    seen.add(stripeId);
    const values=collection==='customers'?customer(item):
      collection==='subscriptions'?subscription(item):invoice(item);
    const row={id:stripeId,values};
    if(new TextEncoder().encode(JSON.stringify(row)).length>16_384)return fail();
    rows.push(row);
  }
  if(new TextEncoder().encode(JSON.stringify(rows)).length>196_608)return fail();
  return {rows,nextCursor:response.has_more?rows.at(-1)!.id:null,
    status:response.has_more?'partial' as const:'pages_exhausted' as const};
}
