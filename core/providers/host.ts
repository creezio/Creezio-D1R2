import {createDataAccess} from '../data/service.ts';
import type {DataCredential,DataLease,DataRecord,PermissionDefinition,RuntimeDataCatalog} from '../data/types.ts';
import type {IdentityDatabase} from '../identity/d1-store.ts';
import {createVaultKeyring,isVaultReference,plainRecord,VaultError,type VaultKeyring} from '../vault/crypto.ts';
import {createVaultService,type VaultStorage} from '../vault/service.ts';
import type {ProviderConfigStorage,ProviderHttpPort,ProviderTransport} from '../../sdk/providers/types.ts';
import type {AuthorizationAudience} from '../authorization/types.ts';

const ID='openai.responses.v1';
const MODEL=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const REF=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
type Request={readonly credential:DataCredential;readonly contextId:string;readonly audience:AuthorizationAudience};

/** Deployment-owned keyring. Missing or malformed configuration never creates a default key. */
export function readProviderKeyring(rawEnvironment:unknown):VaultKeyring|null {
  const raw=rawEnvironment&&typeof rawEnvironment==='object'
    ?(rawEnvironment as Record<string,unknown>).CREEZIO_VAULT_KEYRING:undefined;
  if(raw===undefined||raw===null)return null;
  if(typeof raw!=='string'||raw.length>4096)throw new VaultError('unavailable');
  try{
    const parsed=JSON.parse(raw) as unknown;
    if(!plainRecord(parsed)||Object.keys(parsed).sort().join(',')!=='activeKeyId,keys'
      ||!plainRecord(parsed.keys))throw 0;
    const keys:Record<string,Uint8Array>=Object.create(null);
    for(const [id,encoded] of Object.entries(parsed.keys)){
      if(typeof encoded!=='string'||encoded.length!==43||!/^[A-Za-z0-9_-]{43}$/.test(encoded))throw 0;
      const binary=atob(encoded.replaceAll('-','+').replaceAll('_','/')+'=');
      const bytes=Uint8Array.from(binary,character=>character.charCodeAt(0));
      if(bytes.length!==32||btoa(binary).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'')!==encoded)throw 0;
      keys[id]=bytes;
    }
    return createVaultKeyring({activeKeyId:parsed.activeKeyId as string,keys});
  }catch{throw new VaultError('unavailable');}
}

export function createOpenAiProviderHost(options:{readonly db:IdentityDatabase;readonly catalog:RuntimeDataCatalog;
  readonly permissions:readonly PermissionDefinition[];readonly config:ProviderConfigStorage;
  readonly vault:VaultStorage;readonly keyring:VaultKeyring|null;
  readonly transport:(http:ProviderHttpPort)=>ProviderTransport}) {
  if(options.config.moduleId!=='creezio.openai'||options.vault.moduleId!=='creezio.openai')throw new VaultError('unavailable');
  const data=createDataAccess(options.db,{catalog:options.catalog,permissions:options.permissions});
  const vault=options.keyring?createVaultService({data,catalog:options.catalog,storage:options.vault,keyring:options.keyring}):null;
  const cf=options.config.fields;
  const configFields=[options.config.contextField,...Object.values(cf)];
  const vf=options.vault.fields;
  const vaultFields=[options.vault.contextField,...Object.values(vf)];
  const lease=async(request:Request):Promise<DataLease>=>data.authorize(request.credential,{
    contextId:request.contextId,audience:request.audience,actors:['user','delegated-user'],
    requiredPermissionIds:['creezio.openai:use'],purpose:'operation'}, {moduleId:'creezio.openai'});
  const read=async(active:DataLease)=>data.internalPort(active,{moduleId:options.config.moduleId,
    modelId:options.config.modelId,fields:configFields}).get(options.config.modelId,{key:{[cf.id]:ID}});
  const usable=async(active:DataLease,row:DataRecord|null):Promise<boolean>=>{
    if(!row||row[cf.id]!==ID||row[cf.enabled]!==true||typeof row[cf.modelId]!=='string'
      ||!MODEL.test(String(row[cf.modelId]))||!isVaultReference(row[cf.apiKeyRef])
      ||!Number.isSafeInteger(row[cf.secretVersion])||Number(row[cf.secretVersion])<1||!vault)return false;
    const secret=await data.internalPort(active,{moduleId:options.vault.moduleId,
      modelId:options.vault.modelId,fields:vaultFields}).get(options.vault.modelId,
      {key:{[vf.id]:row[cf.apiKeyRef]},fields:[vf.id,vf.bindingId,vf.version,vf.state]});
    if(!secret||secret[vf.bindingId]!==ID||secret[vf.version]!==row[cf.secretVersion]
      ||secret[vf.state]!=='active')return false;
    // Metadata alone cannot prove that the deployment keyring can open this key.
    // The vault checks and decrypts it without returning plaintext to the caller.
    try{await vault.useSecret(active,{reference:String(row[cf.apiKeyRef]),bindingId:ID},()=>true);}
    catch(error){if(error instanceof VaultError&&['unreadable','conflict'].includes(error.code))return false;throw error;}
    return true;
  };
  return Object.freeze({
    async availability(request:Request){
      const active=await lease(request);
      try{
        const row=await read(active);
        if(!row||row[cf.enabled]!==true||!row[cf.apiKeyRef])return {providerId:ID,state:'missing' as const,modelIds:[]};
        if(!options.keyring)return {providerId:ID,state:'unavailable' as const,modelIds:[]};
        if(!await usable(active,row))return {providerId:ID,state:'invalid' as const,modelIds:[]};
        return {providerId:ID,state:'ready' as const,modelIds:[String(row[cf.modelId])]};
      }finally{data.dispose(active);}
    },
    async withTransport<T>(request:Request,consumer:(transport:ProviderTransport,modelId:string)=>Promise<T>):Promise<T>{
      const active=await lease(request);
      try{
        const row=await read(active);
        if(!await usable(active,row))throw new VaultError('unavailable');
        if(!row)throw new VaultError('unavailable');
        const reference=String(row[cf.apiKeyRef]),modelId=String(row[cf.modelId]);
        const http:ProviderHttpPort=Object.freeze({async request(input:Parameters<ProviderHttpPort['request']>[0]){
          if(!input||!['GET','POST'].includes(input.method)||!['models','responses','response','response-stream','response-cancel'].includes(input.resource)
            ||input.responseId!==undefined&&!REF.test(input.responseId)
            ||input.afterCursor!==undefined&&(!Number.isSafeInteger(input.afterCursor)||input.afterCursor<0))throw new VaultError('invalid_input');
          // Config and authorization are checked before every outbound request, including resume/cancel.
          const fresh=await read(active);
          if(!fresh||fresh[cf.revision]!==row[cf.revision]||fresh[cf.enabled]!==true
            ||fresh[cf.apiKeyRef]!==reference||fresh[cf.secretVersion]!==row[cf.secretVersion])throw new VaultError('conflict');
          const path=input.resource==='models'?'/v1/models':input.resource==='responses'?'/v1/responses':
            `/v1/responses/${encodeURIComponent(input.responseId??'')}${input.resource==='response-cancel'?'/cancel':''}`;
          if(['response','response-stream','response-cancel'].includes(input.resource)&&!input.responseId)throw new VaultError('invalid_input');
          const url=new URL(path,'https://api.openai.com');
          if(input.resource==='response-stream'){
            url.searchParams.set('stream','true');url.searchParams.set('starting_after',String(input.afterCursor??0));
          }
          return vault!.useSecret(active,{reference,bindingId:ID},secret=>fetch(url,{
            method:input.method,signal:input.signal,headers:{authorization:`Bearer ${secret}`,
              'content-type':'application/json'},...(input.body===undefined?{}:{body:JSON.stringify(input.body)})}));
        }});
        return await consumer(options.transport(http),modelId);
      }finally{data.dispose(active);}
    }
  });
}
