import type {VaultStorage} from '../../../../core/vault/service.ts';
import type {ProviderConfigStorage} from '../../../../sdk/providers/types.ts';

export const OPENAI_PROVIDER_ID='openai.responses.v1';
export const OPENAI_MODULE_ID='creezio.openai';

/** Public static mapping consumed by the trusted host. No table names or secrets. */
export const openAiConfigStorage:ProviderConfigStorage=Object.freeze({
  moduleId:OPENAI_MODULE_ID,modelId:'provider_config',contextField:'context_id',
  fields:Object.freeze({id:'id',modelId:'model_id',apiKeyRef:'api_key_ref',
    secretVersion:'secret_version',enabled:'enabled',revision:'revision',updatedAt:'updated_at'})
});

export const openAiVaultStorage:VaultStorage=Object.freeze({
  moduleId:OPENAI_MODULE_ID,modelId:'provider_secret',contextField:'context_id',
  fields:Object.freeze({id:'id',bindingId:'binding_id',ciphertext:'ciphertext',
    keyId:'key_id',version:'version',state:'state'})
});
