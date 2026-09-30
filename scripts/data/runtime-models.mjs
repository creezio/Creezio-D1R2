import { OPERATION_STORAGE_MODULE_ID, OPERATION_MODELS, OPERATION_TABLES } from '../../core/operations/models.ts';
import { STORAGE_AUTHORITY_MODULE_ID, STORAGE_AUTHORITY_MODELS, STORAGE_AUTHORITY_TABLES } from '../../core/storage-authority/models.ts';

/** Fixed host inventory shared by the standalone artifact and composition compiler. */
export const RUNTIME_STORAGE_MODULE_ID = OPERATION_STORAGE_MODULE_ID;
export const RUNTIME_MODELS = Object.freeze([...OPERATION_MODELS, ...STORAGE_AUTHORITY_MODELS]);
export const RUNTIME_TABLES = Object.freeze({...OPERATION_TABLES, ...STORAGE_AUTHORITY_TABLES});
if (STORAGE_AUTHORITY_MODULE_ID !== RUNTIME_STORAGE_MODULE_ID
  || new Set(RUNTIME_MODELS.map(model => model.id)).size !== RUNTIME_MODELS.length
  || Object.keys(RUNTIME_TABLES).length !== RUNTIME_MODELS.length)
  throw new Error('Host runtime model inventory differs.');
