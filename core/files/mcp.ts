import type {IdentityDatabase} from '../identity/d1-store.ts';
import type {StorageRouteIdentity} from '../storage-authority/target.ts';
import {createDataAccess} from '../data/service.ts';
import type {RuntimeDataCatalog, PermissionDefinition} from '../data/types.ts';
import type {McpAuthenticatedRequest} from '../mcp/http.ts';
import type {McpLinkedImageToolBinding} from '../mcp/types.ts';
import {resolveFileCategory, type RuntimeFileCatalog} from './catalog.ts';
import {createFileService, type FileBucket, type PrivateFile, type StagedFile} from './service.ts';
import {FileError} from './mapping.ts';
import {createD1IdentityStore} from '../identity/d1-store.ts';
import {admitFileRequest} from './admission.ts';

/** MCP image transport reuses the same linked proof and native data guard as file HTTP. */
export async function readMcpLinkedImage(options:{db:IdentityDatabase;catalog:RuntimeDataCatalog;
  files:RuntimeFileCatalog;permissions:readonly PermissionDefinition[];bucket:FileBucket;
  authorityDb?:IdentityDatabase;storageRoute?:StorageRouteIdentity},
  binding:McpLinkedImageToolBinding,identity:McpAuthenticatedRequest,
  recordId:string,reference:StagedFile):Promise<PrivateFile> {
  const category=resolveFileCategory(options.catalog,options.files,binding.moduleId,binding.categoryId,'app');
  if (category.linkedRead?.mcpImage?.toolName!==binding.name
    || !category.linkedRead.audiences.includes('app')
    || binding.permissions.length!==1
    || binding.permissions[0]!==`${binding.moduleId}:${category.linkedRead.permission.id}`
    || category.maxBytes>2*1024*1024
    || category.mimeTypes.some(type=>!['image/png','image/jpeg','image/webp'].includes(type)))
    throw new FileError('invalid_mapping');
  const data=createDataAccess(options.db,{catalog:options.catalog,permissions:options.permissions,
    authorityDb:options.authorityDb,storageRoute:options.storageRoute});
  if(!await admitFileRequest(createD1IdentityStore(options.authorityDb??options.db),binding.moduleId,binding.categoryId,
    'app',identity.credential.token))throw new FileError('unavailable');
  const lease=await data.authorize(identity.credential,{contextId:identity.contextId,audience:'app',
    actors:['delegated-user'],requiredPermissionIds:[binding.permissions[0]],purpose:'operation'},
  {moduleId:binding.moduleId});
  try {
    const service=createFileService({data,catalog:options.catalog,moduleId:binding.moduleId,
      category,bucket:options.bucket});
    return await service.readLinked(lease,reference,recordId);
  } finally {data.dispose(lease);}
}
