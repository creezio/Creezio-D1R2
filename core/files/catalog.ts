import type {AuthorizationAudience} from '../authorization/types.ts';
import type {RuntimeDataCatalog} from '../data/types.ts';
import {captureFileCategory, FileError, type FileCategory} from './mapping.ts';

export interface RuntimeFileCatalog {
  readonly compositionDigest: string;
  readonly categories: readonly {readonly moduleId: string; readonly category: FileCategory;
    readonly audiences: readonly AuthorizationAudience[]}[];
}

export function resolveFileCategory(catalog: RuntimeDataCatalog, files: RuntimeFileCatalog,
  moduleId: string, categoryId: string, audience: AuthorizationAudience): FileCategory {
  if (files.compositionDigest !== catalog.compositionDigest) throw new FileError('invalid_mapping');
  const matches = files.categories.filter(item => item.moduleId === moduleId && item.category.id === categoryId && item.audiences.includes(audience));
  if (matches.length !== 1) throw new FileError('not_found');
  return captureFileCategory(catalog, moduleId, matches[0]!.category);
}

/** Principal IDs are never concatenated ambiguously or truncated to fit an owner column. */
export async function fileOwnerId(principalId: string, audience: AuthorizationAudience): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(['creezio.files.owner.v1', audience, principalId]));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return `owner_${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')}`;
}
