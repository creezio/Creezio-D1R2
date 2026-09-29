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
  staticHeaders:Object.freeze([{name:'Stripe-Version',value:STRIPE_API_VERSION}]),
  resources:Object.freeze([
    Object.freeze({id:'customers',method:'GET' as const,path:'/v1/customers',params:Object.freeze(['cursor','limit'] as const),
      query:Object.freeze({cursor:'starting_after',limit:'limit'})}),
    Object.freeze({id:'subscriptions',method:'GET' as const,path:'/v1/subscriptions',params:Object.freeze(['cursor','limit'] as const),
      query:Object.freeze({cursor:'starting_after',limit:'limit',fixed:Object.freeze([{name:'status',value:'all'}])})}),
    Object.freeze({id:'invoices',method:'GET' as const,path:'/v1/invoices',params:Object.freeze(['cursor','limit'] as const),
      query:Object.freeze({cursor:'starting_after',limit:'limit'})}),
  ])
});
export const stripeConnectorDescriptor:ConnectorDescriptor=descriptor;
