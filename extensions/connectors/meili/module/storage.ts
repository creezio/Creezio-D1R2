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

/** Build-owned paths and bodies; callers cannot supply a URL, method or header. */
export const meiliConnectorDescriptor:ConnectorDescriptor=Object.freeze({
  id:MEILI_CONNECTOR_ID,moduleId:MEILI_MODULE_ID,config:meiliConfigStorage,vault:meiliVaultStorage,
  auth:Object.freeze({kind:'bearer'}),
  resources:Object.freeze([
    Object.freeze({id:'indexes',method:'GET' as const,path:'/indexes',params:Object.freeze([] as const),
      query:Object.freeze({fixed:Object.freeze([{name:'limit',value:'1'}])})}),
    Object.freeze({id:'index-list',method:'GET' as const,path:'/indexes',
      params:Object.freeze(['cursor','limit'] as const),
      query:Object.freeze({cursor:'offset',limit:'limit'})}),
    Object.freeze({id:'document-upsert',method:'POST' as const,path:'/indexes/{id}/documents',
      params:Object.freeze(['id'] as const),successStatuses:Object.freeze([202]),
      query:Object.freeze({fixed:Object.freeze([{name:'primaryKey',value:'id'}])}),
      body:Object.freeze({encoding:'json-root' as const,fields:Object.freeze([
        Object.freeze({name:'documents',wireName:'documents',kind:'json' as const,required:true,maxBytes:64_000})])})}),
    Object.freeze({id:'document-delete',method:'POST' as const,path:'/indexes/{id}/documents/delete-batch',
      params:Object.freeze(['id'] as const),successStatuses:Object.freeze([202]),
      body:Object.freeze({encoding:'json-root' as const,fields:Object.freeze([
        Object.freeze({name:'ids',wireName:'ids',kind:'json' as const,required:true,maxBytes:8_000})])})}),
    Object.freeze({id:'task',method:'GET' as const,path:'/tasks/{id}',params:Object.freeze(['id'] as const)}),
    Object.freeze({id:'search',method:'GET' as const,path:'/indexes/{id}/search',
      params:Object.freeze(['id','cursor','limit'] as const),
      query:Object.freeze({cursor:'offset',limit:'limit',fields:Object.freeze([
        Object.freeze({name:'q',wireName:'q',kind:'string' as const,maxBytes:256})])})})
  ])
});
