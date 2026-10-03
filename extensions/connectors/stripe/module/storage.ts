import type {ConnectorConfigStorage,ConnectorVaultStorage,ConnectorDescriptor} from '@creezio/sdk/connectors/types';

export const STRIPE_MODULE_ID='creezio.stripe';
export const STRIPE_CONNECTOR_ID='stripe.api.v1';
export const STRIPE_ORIGIN='https://api.stripe.com';
export const STRIPE_API_VERSION='2026-08-26.dahlia';

export const stripeConfigStorage:ConnectorConfigStorage=Object.freeze({
  moduleId:STRIPE_MODULE_ID,modelId:'connector_config',contextField:'context_id',
  fields:Object.freeze({id:'id',origin:'origin',keyRef:'key_ref',secretVersion:'secret_version',
    enabled:'enabled',revision:'revision',updatedAt:'updated_at'})
});
export const stripeVaultStorage:ConnectorVaultStorage=Object.freeze({
  moduleId:STRIPE_MODULE_ID,modelId:'connector_secret',contextField:'context_id',
  fields:Object.freeze({id:'id',bindingId:'binding_id',ciphertext:'ciphertext',keyId:'key_id',
    version:'version',state:'state'})
});

/** All egress choices are build-owned. The handler cannot choose a URL, header or query name. */
const descriptor=Object.freeze({
  id:STRIPE_CONNECTOR_ID,moduleId:STRIPE_MODULE_ID,config:stripeConfigStorage,vault:stripeVaultStorage,
  auth:Object.freeze({kind:'bearer' as const}),fixedOrigin:STRIPE_ORIGIN,
  mutationSecretPrefix:'sk_test_',
  webhook:Object.freeze({path:'/api/webhooks/stripe',operationId:'event.receive',scheme:'stripe' as const,
    mapper:Object.freeze({path:'module/webhook.ts',export:'stripeWebhookInput'}),
    fields:Object.freeze({connectionId:'connection_id',signingRef:'webhook_key_ref',
      signingVersion:'webhook_secret_version',previousRef:'webhook_previous_key_ref',
      previousVersion:'webhook_previous_secret_version',
      serviceTokenRef:'webhook_service_token_ref',
      serviceTokenVersion:'webhook_service_token_version'})}),
  staticHeaders:Object.freeze([{name:'Stripe-Version',value:STRIPE_API_VERSION}]),
  resources:Object.freeze([
    Object.freeze({id:'customers',method:'GET' as const,path:'/v1/customers',params:Object.freeze(['cursor','limit'] as const),
      query:Object.freeze({cursor:'starting_after',limit:'limit'})}),
    Object.freeze({id:'subscriptions',method:'GET' as const,path:'/v1/subscriptions',params:Object.freeze(['cursor','limit'] as const),
      query:Object.freeze({cursor:'starting_after',limit:'limit',fixed:Object.freeze([{name:'status',value:'all'}])})}),
    Object.freeze({id:'invoices',method:'GET' as const,path:'/v1/invoices',params:Object.freeze(['cursor','limit'] as const),
      query:Object.freeze({cursor:'starting_after',limit:'limit'})}),
    Object.freeze({id:'products',method:'GET' as const,path:'/v1/products',params:Object.freeze(['cursor','limit'] as const),
      query:Object.freeze({cursor:'starting_after',limit:'limit'})}),
    Object.freeze({id:'prices_active',method:'GET' as const,path:'/v1/prices',params:Object.freeze(['cursor','limit'] as const),
      query:Object.freeze({cursor:'starting_after',limit:'limit',fixed:Object.freeze([{name:'active',value:'true'}])})}),
    Object.freeze({id:'prices_inactive',method:'GET' as const,path:'/v1/prices',params:Object.freeze(['cursor','limit'] as const),
      query:Object.freeze({cursor:'starting_after',limit:'limit',fixed:Object.freeze([{name:'active',value:'false'}])})}),
    Object.freeze({id:'checkout_payment_create',method:'POST' as const,path:'/v1/checkout/sessions',
      params:Object.freeze([] as const),idempotencyHeader:'Idempotency-Key',successStatuses:Object.freeze([200]),
      body:Object.freeze({encoding:'form' as const,fixed:Object.freeze([{name:'mode',value:'payment'}]),
        fields:Object.freeze([
          {name:'priceId',wireName:'line_items[0][price]',kind:'string' as const,required:true,maxBytes:128},
          {name:'quantity',wireName:'line_items[0][quantity]',kind:'integer' as const,required:true,maxBytes:8},
          {name:'successUrl',wireName:'success_url',kind:'string' as const,required:true,maxBytes:2048},
          {name:'cancelUrl',wireName:'cancel_url',kind:'string' as const,required:true,maxBytes:2048},
          {name:'clientReferenceId',wireName:'client_reference_id',kind:'string' as const,required:true,maxBytes:128},
          {name:'customerId',wireName:'customer',kind:'string' as const,maxBytes:128}])})}),
    Object.freeze({id:'checkout_subscription_create',method:'POST' as const,path:'/v1/checkout/sessions',
      params:Object.freeze([] as const),idempotencyHeader:'Idempotency-Key',successStatuses:Object.freeze([200]),
      body:Object.freeze({encoding:'form' as const,fixed:Object.freeze([{name:'mode',value:'subscription'}]),
        fields:Object.freeze([
          {name:'priceId',wireName:'line_items[0][price]',kind:'string' as const,required:true,maxBytes:128},
          {name:'quantity',wireName:'line_items[0][quantity]',kind:'integer' as const,required:true,maxBytes:8},
          {name:'successUrl',wireName:'success_url',kind:'string' as const,required:true,maxBytes:2048},
          {name:'cancelUrl',wireName:'cancel_url',kind:'string' as const,required:true,maxBytes:2048},
          {name:'clientReferenceId',wireName:'client_reference_id',kind:'string' as const,required:true,maxBytes:128},
          {name:'customerId',wireName:'customer',kind:'string' as const,maxBytes:128}])})}),
    Object.freeze({id:'checkout_session',method:'GET' as const,path:'/v1/checkout/sessions/{id}',
      params:Object.freeze(['id'] as const)}),
    Object.freeze({id:'subscription_schedule_cancel',method:'POST' as const,
      path:'/v1/subscriptions/{id}',params:Object.freeze(['id'] as const),
      idempotencyHeader:'Idempotency-Key',successStatuses:Object.freeze([200]),
      body:Object.freeze({encoding:'form' as const,fields:Object.freeze([
        {name:'cancelAtPeriodEnd',wireName:'cancel_at_period_end',kind:'boolean' as const,
          required:true,maxBytes:5}])})}),
    Object.freeze({id:'subscription_plan_set',method:'POST' as const,
      path:'/v1/subscriptions/{id}',params:Object.freeze(['id'] as const),
      idempotencyHeader:'Idempotency-Key',successStatuses:Object.freeze([200]),
      body:Object.freeze({encoding:'form' as const,
        fixed:Object.freeze([{name:'proration_behavior',value:'none'},
          {name:'payment_behavior',value:'error_if_incomplete'}]),fields:Object.freeze([
          {name:'itemId',wireName:'items[0][id]',kind:'string' as const,required:true,maxBytes:128},
          {name:'priceId',wireName:'items[0][price]',kind:'string' as const,required:true,maxBytes:128},
          {name:'quantity',wireName:'items[0][quantity]',kind:'integer' as const,required:true,maxBytes:8}])})}),
  ])
});
export const stripeConnectorDescriptor:ConnectorDescriptor=descriptor;
