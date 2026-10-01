import type {ConnectorConfigStorage,ConnectorVaultStorage,ConnectorDescriptor,ConnectorBodyField} from '@creezio/sdk/connectors/types';

export const RESEND_MODULE_ID='creezio.resend';
export const RESEND_CONNECTOR_ID='resend.api.v1';
export const RESEND_ORIGIN='https://api.resend.com';

export const resendConfigStorage:ConnectorConfigStorage=Object.freeze({
  moduleId:RESEND_MODULE_ID,modelId:'connector_config',contextField:'context_id',
  fields:Object.freeze({id:'id',origin:'origin',keyRef:'key_ref',secretVersion:'secret_version',
    enabled:'enabled',revision:'revision',updatedAt:'updated_at',connectionId:'connection_id'})
});
export const resendVaultStorage:ConnectorVaultStorage=Object.freeze({
  moduleId:RESEND_MODULE_ID,modelId:'connector_secret',contextField:'context_id',
  fields:Object.freeze({id:'id',bindingId:'binding_id',ciphertext:'ciphertext',keyId:'key_id',
    version:'version',state:'state'})
});

/** Provider paths, fields and headers are build-owned; handlers cannot choose an outbound URL. */
export const resendConnectorDescriptor:ConnectorDescriptor=Object.freeze({
  id:RESEND_CONNECTOR_ID,moduleId:RESEND_MODULE_ID,config:resendConfigStorage,vault:resendVaultStorage,
  auth:Object.freeze({kind:'bearer'}),fixedOrigin:RESEND_ORIGIN,
  webhook:Object.freeze({path:'/api/webhooks/resend',operationId:'event.receive',scheme:'resend' as const,
    mapper:Object.freeze({path:'module/webhook.ts',export:'resendWebhookInput'}),
    fields:Object.freeze({connectionId:'connection_id',signingRef:'webhook_key_ref',
      signingVersion:'webhook_secret_version',previousRef:'webhook_previous_key_ref',
      previousVersion:'webhook_previous_secret_version',serviceTokenRef:'webhook_service_token_ref',
      serviceTokenVersion:'webhook_service_token_version'})}),
  resources:Object.freeze([
    Object.freeze({id:'domains',method:'GET',path:'/domains',params:Object.freeze([] as const)}),
    Object.freeze({id:'email.received',method:'GET',path:'/emails/receiving/{id}',
      params:Object.freeze(['id'] as const)}),
    Object.freeze({id:'email.send',method:'POST',path:'/emails',params:Object.freeze([] as const),
      idempotencyHeader:'Idempotency-Key',successStatuses:Object.freeze([200,201]),
      attachments:Object.freeze({wireName:'attachments',maxItems:50,maxBytes:10*1024*1024}),
      body:Object.freeze({encoding:'json',fields:Object.freeze([
        {name:'from',wireName:'from',kind:'string',required:true,maxBytes:320},
        {name:'to',wireName:'to',kind:'json',required:true,maxBytes:2048},
        {name:'cc',wireName:'cc',kind:'json',maxBytes:2048},
        {name:'bcc',wireName:'bcc',kind:'json',maxBytes:2048},
        {name:'replyTo',wireName:'reply_to',kind:'string',maxBytes:320},
        {name:'subject',wireName:'subject',kind:'string',required:true,maxBytes:240},
        {name:'text',wireName:'text',kind:'string',maxBytes:16_000},
        {name:'html',wireName:'html',kind:'string',maxBytes:32_000}
      ] satisfies ConnectorBodyField[])})})
  ]),
  binaryDownloads:Object.freeze([Object.freeze({id:'email.received.attachment',proofOperationId:'received.read',
    metadataPath:'/emails/receiving/{parentId}/attachments/{childId}',
    cdnOrigin:'https://inbound-cdn.resend.com',
    cdnPath:'/{parentId}/attachments/{childId}',maxBytes:10*1024*1024,
    event:Object.freeze({modelId:'webhook_event',indexId:'by-email',connectionField:'connection_id',
      parentField:'email_id',typeField:'event_type',typeValue:'email.received'})})])
});
