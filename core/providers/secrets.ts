import type {DataAccess,DataLease,DataPlan,RuntimeDataCatalog} from '../data/types.ts';
import {createVaultReference,isVaultReference,plainRecord,VaultError,type VaultKeyring} from '../vault/crypto.ts';
import {createVaultService,type VaultStorage} from '../vault/service.ts';
import type {ProviderSecretsPort} from '../../sdk/providers/types.ts';

const secret=(value:unknown):value is string=>typeof value==='string'&&value.length>0
  &&new TextEncoder().encode(value).length<=16_384&&value.isWellFormed();

/** Narrow preparation capability. The calling operation owns the final T06 batch. */
export function createProviderSecretsPort(options:{readonly data:DataAccess;readonly catalog:RuntimeDataCatalog;
  readonly storage:VaultStorage;readonly keyring:VaultKeyring;readonly lease:DataLease;
  readonly providerId:string;readonly register:(plan:DataPlan)=>void}):ProviderSecretsPort {
  // Reuse the vault's static storage validation; no module handler receives this service.
  createVaultService({data:options.data,catalog:options.catalog,storage:options.storage,keyring:options.keyring});
  const {data,storage,keyring,lease}=options,m=storage.fields;
  const port=data.internalPort(lease,{moduleId:storage.moduleId,modelId:storage.modelId,
    fields:[storage.contextField,...Object.values(m)]});
  const context=(reference:string,version:number)=>({moduleId:storage.moduleId,
    contextId:data.describeLease(lease).contextId,bindingId:options.providerId,reference,version});
  const checkProvider=(value:unknown)=>{if(value!==options.providerId)throw new VaultError('invalid_input');};
  const row=async(reference:string,expectedVersion:number)=>{
    if(!isVaultReference(reference)||!Number.isSafeInteger(expectedVersion)||expectedVersion<1)throw new VaultError('invalid_input');
    const found=await port.get(storage.modelId,{key:{[m.id]:reference},
      fields:[m.id,m.bindingId,m.version,m.state]});
    if(!found||found[m.bindingId]!==options.providerId||found[m.state]!=='active'
      ||found[m.version]!==expectedVersion)throw new VaultError('conflict');
    return found;
  };
  return Object.freeze({
    async preparePut(input:Parameters<ProviderSecretsPort['preparePut']>[0]){
      if(!plainRecord(input)||Object.keys(input).sort().join(',')!=='providerId,secret')throw new VaultError('invalid_input');
      checkProvider(input.providerId);if(!secret(input.secret))throw new VaultError('invalid_input');
      const reference=createVaultReference(),version=1;
      const ciphertext=await keyring.seal(context(reference,version),input.secret);
      const plan=port.planCreate(storage.modelId,{values:{[m.id]:reference,[m.bindingId]:options.providerId,
        [m.ciphertext]:ciphertext,[m.keyId]:keyring.activeKeyId,[m.version]:version,[m.state]:'active'}});
      options.register(plan);return Object.freeze({plan,reference,version});
    },
    async prepareReplace(input:Parameters<ProviderSecretsPort['prepareReplace']>[0]){
      if(!plainRecord(input)||Object.keys(input).sort().join(',')!=='expectedVersion,providerId,reference,secret')
        throw new VaultError('invalid_input');
      checkProvider(input.providerId);if(!secret(input.secret))throw new VaultError('invalid_input');
      await row(input.reference,input.expectedVersion);
      const version=input.expectedVersion+1;
      const ciphertext=await keyring.seal(context(input.reference,version),input.secret);
      const plan=port.planPatch(storage.modelId,{key:{[m.id]:input.reference},
        where:{[m.bindingId]:options.providerId,[m.state]:'active'},
        compare:{field:m.version,expected:input.expectedVersion},
        values:{[m.ciphertext]:ciphertext,[m.keyId]:keyring.activeKeyId}});
      options.register(plan);return Object.freeze({plan,reference:input.reference,version});
    },
    async prepareRevoke(input:Parameters<ProviderSecretsPort['prepareRevoke']>[0]){
      if(!plainRecord(input)||Object.keys(input).sort().join(',')!=='expectedVersion,providerId,reference')
        throw new VaultError('invalid_input');
      checkProvider(input.providerId);await row(input.reference,input.expectedVersion);
      const plan=port.planPatch(storage.modelId,{key:{[m.id]:input.reference},
        where:{[m.bindingId]:options.providerId,[m.state]:'active'},
        compare:{field:m.version,expected:input.expectedVersion},values:{[m.state]:'revoked'}});
      options.register(plan);return Object.freeze({plan,version:input.expectedVersion+1});
    },
  });
}
