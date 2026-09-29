import type {ConnectorConfigStorage,ConnectorVaultStorage,ConnectorDescriptor} from '@creezio/sdk/connectors/types';

export const MEILI_MODULE_ID='creezio.meili';
export const MEILI_CONNECTOR_ID='meili.api.v1';

export const meiliConfigStorage:ConnectorConfigStorage=Object.freeze({
  moduleId:MEILI_MODULE_ID,modelId:'connector_config',contextField:'context_id',
  fields:Object.freeze({id:'id',origin:'origin',keyRef:'key_ref',secretVersion:'secret_version',
    enabled:'enabled',revision:'revision',updatedAt:'updated_at'})
});
export const meiliVaultStorage:ConnectorVaultStorage=Object.freeze({
  moduleId:MEILI_MODULE_ID,modelId:'connector_secret',contextField:'context_id',
  fields:Object.freeze({id:'id',bindingId:'binding_id',ciphertext:'ciphertext',keyId:'key_id',
    version:'version',state:'state'})
});

/** The module can request only this build-owned authenticated probe. */
export const meiliConnectorDescriptor:ConnectorDescriptor=Object.freeze({
  id:MEILI_CONNECTOR_ID,moduleId:MEILI_MODULE_ID,config:meiliConfigStorage,vault:meiliVaultStorage,
  auth:Object.freeze({kind:'bearer'}),
  resources:Object.freeze([
    Object.freeze({id:'indexes',method:'GET' as const,path:'/indexes',params:Object.freeze([] as const),
      query:Object.freeze({fixed:Object.freeze([{name:'limit',value:'1'}])})})
  ])
});
