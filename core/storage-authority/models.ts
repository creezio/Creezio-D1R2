import type {DataField,DataModel} from '../data/types.ts';

/** Host-owned models for a routed D1. The central SQL compiler must include these before activation. */
export const STORAGE_AUTHORITY_MODULE_ID='creezio.runtime';
const text=(id:string,maxLength=128,nullable=false):DataField=>({id,type:'string',nullable,protected:true,
  computed:false,constraints:{minLength:1,maxLength}});
const integer=(id:string,nullable=false):DataField=>({id,type:'integer',nullable,protected:true,
  computed:false,constraints:{minimum:0,maximum:Number.MAX_SAFE_INTEGER}});
const enumeration=(id:string,values:string[]):DataField=>({...text(id),constraints:{enum:values}});
const model=(id:string,fields:DataField[],indexes:DataModel['indexes']):DataModel=>({id,
  title:`Storage authority ${id}`,scope:'application',fields,primaryKey:['id'],indexes,relations:[],
  permissions:[],deletion:{mode:'hard',requiresApproval:true},public:false});
const index=(id:string,fields:string[],unique=false)=>({id,fields,unique});
function freeze<T>(value:T):T{
  if(value&&typeof value==='object'){
    for(const child of Object.values(value))freeze(child);
    Object.freeze(value);
  }
  return value;
}
export const STORAGE_AUTHORITY_MODELS:readonly DataModel[]=freeze([
  model('storage_routes',[text('id'),text('installation_id'),integer('slot'),integer('generation'),
    enumeration('state',['active','deny']),text('mutation_id',128,true),integer('source_epoch'),integer('updated_at_ms')],
  [index('installation-slot',['installation_id','slot'],true)]),
  model('storage_grants',[text('id'),text('context_id'),integer('generation'),text('credential_digest',71),
    text('principal_id'),text('actor_principal_id'),enumeration('audience',['admin','app']),text('module_id'),
    text('target_digest',71),integer('source_epoch'),integer('expires_at_ms')],
  [index('context-generation',['context_id','generation','expires_at_ms'])]),
  model('storage_mutations',[text('id'),text('installation_id'),text('context_id'),integer('generation'),
    text('command_digest',71),enumeration('state',['prepared','fenced','source-attempted','source-confirmed','open']),
    integer('created_at_ms'),integer('updated_at_ms')],
  [index('context-state',['context_id','state','updated_at_ms'])]),
  model('storage_source_receipts',[text('id'),text('command_digest',71),text('kind',64),
    text('target_id'),enumeration('effect',['revoked','no-op']),integer('created_at_ms')],
  [index('target-kind',['target_id','kind','created_at_ms'])]),
]);
const hex=(value:string)=>Array.from(new TextEncoder().encode(value),byte=>byte.toString(16).padStart(2,'0')).join('');
export const STORAGE_AUTHORITY_TABLES=Object.freeze(Object.fromEntries(STORAGE_AUTHORITY_MODELS.map(item=>
  [item.id,`cz_${hex(STORAGE_AUTHORITY_MODULE_ID)}_${hex(item.id)}`])) as Record<'storage_routes'|'storage_grants'|'storage_mutations'|'storage_source_receipts',string>);
