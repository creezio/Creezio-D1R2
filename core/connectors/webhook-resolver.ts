import type {IdentityDatabase} from '../identity/d1-store.ts';
import type {RuntimeDataCatalog} from '../data/types.ts';
import type {ConnectorDescriptor} from '../../sdk/connectors/types.ts';
import type {VaultKeyring} from '../vault/crypto.ts';
import {isVaultReference} from '../vault/crypto.ts';
import {digestOpaqueToken} from '../identity/tokens.ts';
import type {SignedWebhookBinding,SignedWebhookConfiguration} from './webhook-http.ts';

export interface CompiledWebhookMapping {
  readonly moduleId:string;readonly operationId:string;readonly path:string;
  readonly map:SignedWebhookConfiguration['map'];
}
/** Host resolver reads only build-selected protected columns for one configured context. */
export function createVaultedWebhookResolver(options:Readonly<{db:IdentityDatabase;
  catalog:RuntimeDataCatalog;keyring:VaultKeyring|null;contextId:string;
  connectors:readonly ConnectorDescriptor[];mappings:readonly CompiledWebhookMapping[]}>){
  const table=(moduleId:string,modelId:string)=>{
    const name=options.catalog.modules.find(item=>item.moduleId===moduleId&&item.enabled)
      ?.models.find(item=>item.modelId===modelId)?.table;
    if(!name||!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name))throw new Error('Invalid webhook model');
    return `"${name}"`;
  };
  const field=(value:string)=>{
    if(!/^[a-z][a-z0-9_]*$/u.test(value))throw new Error('Invalid webhook field');
    return `"${value}"`;
  };
  if(!options.contextId||options.contextId.length>128||!options.keyring)
    return async(_binding:SignedWebhookBinding):Promise<SignedWebhookConfiguration|null>=>null;
  return async(binding:SignedWebhookBinding):Promise<SignedWebhookConfiguration|null>=>{
    const connector=options.connectors.find(item=>item.moduleId===binding.moduleId
      &&item.webhook?.operationId===binding.operationId&&item.webhook?.path===binding.path);
    const mapping=options.mappings.find(item=>item.moduleId===binding.moduleId
      &&item.operationId===binding.operationId&&item.path===binding.path);
    if(!connector?.webhook||!mapping||binding.auth.length!==1
      ||binding.auth[0]!=='webhook-signature')return null;
    const webhook=connector.webhook,cf=connector.config.fields,vf=connector.vault.fields,wf=webhook.fields;
    try{
      const configTable=table(connector.moduleId,connector.config.modelId);
      const vaultTable=table(connector.moduleId,connector.vault.modelId);
      const projection=[cf.revision,cf.enabled,wf.connectionId,wf.signingRef,wf.signingVersion,
        wf.previousRef,wf.previousVersion,wf.serviceTokenRef,wf.serviceTokenVersion];
      const sql=`SELECT ${projection.map(field).join(',')} FROM ${configTable} WHERE ${field(connector.config.contextField)}=? AND ${field(cf.id)}=? LIMIT 1`;
      const row=await options.db.prepare(sql).bind(options.contextId,connector.id).first() as Record<string,unknown>|null;
      if(!row||row[cf.enabled]!==1&&row[cf.enabled]!==true
        ||typeof row[wf.connectionId]!=='string'||!isVaultReference(row[wf.signingRef])
        ||!isVaultReference(row[wf.serviceTokenRef]))return null;
      const open=async(ref:unknown,version:unknown)=>{
        if(!isVaultReference(ref)||!Number.isSafeInteger(version)||Number(version)<1)return null;
        const secret=await options.db.prepare(`SELECT ${[vf.id,vf.version,vf.state,vf.bindingId,
          vf.ciphertext,vf.keyId].map(field).join(',')} FROM ${vaultTable} WHERE ${field(connector.vault.contextField)}=? AND ${field(vf.id)}=? LIMIT 1`)
          .bind(options.contextId,ref).first() as Record<string,unknown>|null;
        if(!secret||secret[vf.version]!==version||secret[vf.state]!=='active'
          ||secret[vf.bindingId]!==connector.id||typeof secret[vf.ciphertext]!=='string'
          ||typeof secret[vf.keyId]!=='string'||String(secret[vf.ciphertext]).split('.')[1]!==secret[vf.keyId])
          return null;
        return options.keyring!.open({moduleId:connector.moduleId,contextId:options.contextId,
          bindingId:connector.id,reference:ref,version:Number(version)},String(secret[vf.ciphertext]));
      };
      const current=await open(row[wf.signingRef],row[wf.signingVersion]);
      const previous=row[wf.previousRef]===null?null:await open(row[wf.previousRef],row[wf.previousVersion]);
      const serviceToken=await open(row[wf.serviceTokenRef],row[wf.serviceTokenVersion]);
      if(!current||!serviceToken||!await digestOpaqueToken(serviceToken,'api-token'))return null;
      const check=await options.db.prepare(`SELECT ${field(cf.revision)} FROM ${configTable} WHERE ${field(connector.config.contextField)}=? AND ${field(cf.id)}=? LIMIT 1`)
        .bind(options.contextId,connector.id).first() as Record<string,unknown>|null;
      if(check?.[cf.revision]!==row[cf.revision])return null;
      const configGuard={moduleId:connector.moduleId,modelId:connector.config.modelId,
        key:{[cf.id]:connector.id},where:{[cf.revision]:Number(row[cf.revision]),
          [cf.enabled]:true,[wf.connectionId]:String(row[wf.connectionId]),
          [wf.signingRef]:String(row[wf.signingRef]),
          [wf.signingVersion]:Number(row[wf.signingVersion]),
          [wf.previousRef]:row[wf.previousRef]===null?null:String(row[wf.previousRef]),
          [wf.previousVersion]:row[wf.previousVersion]===null?null:Number(row[wf.previousVersion]),
          [wf.serviceTokenRef]:String(row[wf.serviceTokenRef]),
          [wf.serviceTokenVersion]:Number(row[wf.serviceTokenVersion])},
        fields:[cf.id,cf.revision,cf.enabled,wf.connectionId,wf.signingRef,wf.signingVersion,
          wf.previousRef,wf.previousVersion,wf.serviceTokenRef,wf.serviceTokenVersion]};
      const secretGuard=(ref:unknown,version:unknown)=>({moduleId:connector.moduleId,
        modelId:connector.vault.modelId,key:{[vf.id]:String(ref)},
        where:{[vf.version]:Number(version),[vf.state]:'active',[vf.bindingId]:connector.id},
        fields:[vf.id,vf.version,vf.state,vf.bindingId]});
      return {scheme:webhook.scheme,contextId:options.contextId,serviceToken,
        secrets:previous?[current,previous]:[current],map:mapping.map,
        guards:[configGuard,secretGuard(row[wf.signingRef],row[wf.signingVersion]),
          ...(previous?[secretGuard(row[wf.previousRef],row[wf.previousVersion])]:[]),
          secretGuard(row[wf.serviceTokenRef],row[wf.serviceTokenVersion])]};
    }catch{return null;}
  };
}
