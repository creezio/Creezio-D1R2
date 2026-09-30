import type {ConnectorConfigStorage,ConnectorVaultStorage,ConnectorDescriptor} from '@creezio/sdk/connectors/types';

export const GRANOLA_MODULE_ID='creezio.granola';
export const GRANOLA_CONNECTOR_ID='granola.api.v1';
export const GRANOLA_ORIGIN='https://public-api.granola.ai';

export const granolaConfigStorage:ConnectorConfigStorage=Object.freeze({
  moduleId:GRANOLA_MODULE_ID,modelId:'connector_config',contextField:'context_id',
  fields:Object.freeze({id:'id',origin:'origin',keyRef:'key_ref',secretVersion:'secret_version',
    enabled:'enabled',revision:'revision',updatedAt:'updated_at'})
});
export const granolaVaultStorage:ConnectorVaultStorage=Object.freeze({
  moduleId:GRANOLA_MODULE_ID,modelId:'connector_secret',contextField:'context_id',
  fields:Object.freeze({id:'id',bindingId:'binding_id',ciphertext:'ciphertext',keyId:'key_id',
    version:'version',state:'state'})
});

/** Exact official public API routes. No handler can supply an origin, path, or header. */
export const granolaConnectorDescriptor:ConnectorDescriptor=Object.freeze({
  id:GRANOLA_CONNECTOR_ID,moduleId:GRANOLA_MODULE_ID,
  config:granolaConfigStorage,vault:granolaVaultStorage,
  auth:Object.freeze({kind:'bearer'}),fixedOrigin:GRANOLA_ORIGIN,
  webhook:Object.freeze({path:'/api/webhooks/granola',operationId:'event.receive',scheme:'standard' as const,
    mapper:Object.freeze({path:'module/webhook.ts',export:'granolaWebhookInput'}),
    fields:Object.freeze({connectionId:'connection_id',signingRef:'webhook_key_ref',
      signingVersion:'webhook_secret_version',previousRef:'webhook_previous_key_ref',
      previousVersion:'webhook_previous_secret_version',serviceTokenRef:'webhook_service_token_ref',
      serviceTokenVersion:'webhook_service_token_version'})}),
  resources:Object.freeze([
    Object.freeze({id:'notes',method:'GET' as const,path:'/v1/notes',
      params:Object.freeze(['cursor','limit'] as const),query:Object.freeze({cursor:'cursor',limit:'page_size',
        fields:Object.freeze([
          {name:'folderId',wireName:'folder_id',kind:'string' as const,maxBytes:64},
          {name:'createdAfter',wireName:'created_after',kind:'string' as const,maxBytes:40},
          {name:'createdBefore',wireName:'created_before',kind:'string' as const,maxBytes:40},
          {name:'updatedAfter',wireName:'updated_after',kind:'string' as const,maxBytes:40}
        ])})}),
    Object.freeze({id:'note',method:'GET' as const,path:'/v1/notes/{id}',params:Object.freeze(['id'] as const)}),
    Object.freeze({id:'transcript',method:'GET' as const,path:'/v1/notes/{id}/transcript',
      params:Object.freeze(['id','cursor','limit'] as const),query:Object.freeze({cursor:'cursor',limit:'page_size'})}),
    Object.freeze({id:'folders',method:'GET' as const,path:'/v1/folders',
      params:Object.freeze(['cursor','limit'] as const),query:Object.freeze({cursor:'cursor',limit:'page_size'})})
  ])
});
