import type {ConnectorConfigStorage,ConnectorVaultStorage,ConnectorDescriptor} from '@creezio/sdk/connectors/types';

export const HERMES_MODULE_ID='creezio.hermes';
export const HERMES_CONNECTOR_ID='hermes.api.v1';

export const hermesConfigStorage:ConnectorConfigStorage=Object.freeze({
  moduleId:HERMES_MODULE_ID,modelId:'connector_config',contextField:'context_id',
  fields:Object.freeze({id:'id',origin:'origin',keyRef:'key_ref',secretVersion:'secret_version',
    enabled:'enabled',revision:'revision',updatedAt:'updated_at'})
});
export const hermesVaultStorage:ConnectorVaultStorage=Object.freeze({
  moduleId:HERMES_MODULE_ID,modelId:'connector_secret',contextField:'context_id',
  fields:Object.freeze({id:'id',bindingId:'binding_id',ciphertext:'ciphertext',keyId:'key_id',
    version:'version',state:'state'})
});

/** Fixed official API routes. The host owns the HTTPS origin, bearer key and HTTP transport. */
export const hermesConnectorDescriptor:ConnectorDescriptor=Object.freeze({
  id:HERMES_CONNECTOR_ID,moduleId:HERMES_MODULE_ID,config:hermesConfigStorage,vault:hermesVaultStorage,
  auth:Object.freeze({kind:'bearer'}),
  resources:Object.freeze([
    Object.freeze({id:'capabilities',method:'GET',path:'/v1/capabilities',params:Object.freeze([] as const)}),
    Object.freeze({id:'models',method:'GET',path:'/v1/models',params:Object.freeze([] as const)}),
    Object.freeze({id:'model-options',method:'GET',path:'/api/model/options',params:Object.freeze([] as const)}),
    Object.freeze({id:'run',method:'GET',path:'/v1/runs/{id}',params:Object.freeze(['id'] as const)}),
    Object.freeze({id:'run-create',method:'POST',path:'/v1/runs',params:Object.freeze([] as const),
      idempotencyHeader:'Idempotency-Key',successStatuses:Object.freeze([202] as const),
      body:Object.freeze({encoding:'json',fields:Object.freeze([
        Object.freeze({name:'input',wireName:'input',kind:'string',required:true,maxBytes:8192})
      ])})}),
    Object.freeze({id:'run-stop',method:'POST',path:'/v1/runs/{id}/stop',params:Object.freeze(['id'] as const),
      idempotencyHeader:'Idempotency-Key',successStatuses:Object.freeze([200,202] as const)})
  ])
});
