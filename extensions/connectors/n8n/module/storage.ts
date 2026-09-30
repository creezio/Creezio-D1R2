import type {ConnectorConfigStorage,ConnectorVaultStorage,ConnectorDescriptor} from '@creezio/sdk/connectors/types';

export const N8N_MODULE_ID='creezio.n8n';
export const N8N_CONNECTOR_ID='n8n.api.v1';
export const N8N_WEBHOOK_CONNECTOR_ID='n8n.webhook.v1';

export const n8nConfigStorage:ConnectorConfigStorage=Object.freeze({
  moduleId:N8N_MODULE_ID,modelId:'connector_config',contextField:'context_id',
  fields:Object.freeze({id:'id',origin:'origin',keyRef:'key_ref',secretVersion:'secret_version',
    enabled:'enabled',revision:'revision',updatedAt:'updated_at'})
});
export const n8nVaultStorage:ConnectorVaultStorage=Object.freeze({
  moduleId:N8N_MODULE_ID,modelId:'connector_secret',contextField:'context_id',
  fields:Object.freeze({id:'id',bindingId:'binding_id',ciphertext:'ciphertext',keyId:'key_id',
    version:'version',state:'state'})
});
export const n8nWebhookConfigStorage:ConnectorConfigStorage=Object.freeze({
  moduleId:N8N_MODULE_ID,modelId:'webhook_config',contextField:'context_id',
  fields:Object.freeze({id:'id',origin:'origin',keyRef:'key_ref',secretVersion:'secret_version',
    enabled:'enabled',revision:'revision',updatedAt:'updated_at'})
});
export const n8nWebhookVaultStorage:ConnectorVaultStorage=Object.freeze({
  moduleId:N8N_MODULE_ID,modelId:'webhook_secret',contextField:'context_id',
  fields:Object.freeze({id:'id',bindingId:'binding_id',ciphertext:'ciphertext',keyId:'key_id',
    version:'version',state:'state'})
});

/** Only this build-owned descriptor may choose n8n paths and the credential header. */
export const n8nConnectorDescriptor:ConnectorDescriptor=Object.freeze({
  id:N8N_CONNECTOR_ID,moduleId:N8N_MODULE_ID,config:n8nConfigStorage,vault:n8nVaultStorage,
  auth:Object.freeze({kind:'api-key-header',name:'X-N8N-API-KEY'}),
  resources:Object.freeze([
    Object.freeze({id:'workflows',method:'GET',path:'/api/v1/workflows',params:Object.freeze(['cursor','limit'] as const)}),
    Object.freeze({id:'workflow',method:'GET',path:'/api/v1/workflows/{id}',params:Object.freeze(['id'] as const)}),
    Object.freeze({id:'executions',method:'GET',path:'/api/v1/executions',params:Object.freeze(['cursor','limit'] as const)}),
    Object.freeze({id:'execution',method:'GET',path:'/api/v1/executions/{id}',params:Object.freeze(['id'] as const)})
  ])
});

/** The workflow's production Webhook node must separately require this header. */
export const n8nWebhookDescriptor:ConnectorDescriptor=Object.freeze({
  id:N8N_WEBHOOK_CONNECTOR_ID,moduleId:N8N_MODULE_ID,
  config:n8nWebhookConfigStorage,vault:n8nWebhookVaultStorage,
  auth:Object.freeze({kind:'api-key-header',name:'X-Creezio-Webhook-Key'}),
  resources:Object.freeze([
    Object.freeze({id:'trigger',method:'POST',path:'/webhook/{id}',params:Object.freeze(['id'] as const),
      successStatuses:Object.freeze([200,201,202] as const),responseBody:'json',
      body:Object.freeze({encoding:'json',fields:Object.freeze([
        Object.freeze({name:'intentId',wireName:'intentId',kind:'string',required:true,maxBytes:128}),
        Object.freeze({name:'workflowId',wireName:'workflowId',kind:'string',required:true,maxBytes:128}),
        Object.freeze({name:'input',wireName:'input',kind:'json',required:true,maxBytes:8192})
      ])})})
  ])
});
