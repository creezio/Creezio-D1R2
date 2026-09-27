import {sha256} from '@noble/hashes/sha2.js';
import {bytesToHex} from '@noble/hashes/utils.js';

export type InstalledDocumentKind = 'readme' | 'prd' | 'changelog';
export interface InstalledModuleDocumentMetadata {
  readonly moduleId: string;
  readonly origin: string;
  readonly version: string;
  readonly sourceRevision: string;
  readonly runtimeIntegrity: string;
  readonly kind: InstalledDocumentKind;
  readonly visibility: 'public' | 'restricted';
  readonly path: string;
  readonly digest: string;
  readonly byteLength: number;
  readonly blockCount: number;
}
export interface InstalledModuleDocument extends InstalledModuleDocumentMetadata {
  readonly content: string;
}
export interface InstalledModuleDocumentBlock {
  readonly document: InstalledModuleDocumentMetadata;
  readonly blockIndex: number;
  readonly content: string;
  readonly nextBlockIndex: number | null;
}
export const INSTALLED_DOCUMENT_LIMITS = Object.freeze({documentBytes: 64 * 1024,
  moduleBytes: 192 * 1024, totalBytes: 1024 * 1024, blockBytes: 16 * 1024,
  maxBlocks: 8});

export class InstalledDocumentError extends Error {
  readonly code: string;
  constructor(code: string) {super(`Installed documentation refused (${code}).`);this.name='InstalledDocumentError';this.code=code;}
}
const encoder = new TextEncoder();
const fail = (code: string): never => {throw new InstalledDocumentError(code);};

/** Fatal UTF-8 decode; ignoreBOM preserves an initial U+FEFF in the returned text. */
export function decodeInstalledDocument(bytes: Uint8Array): string {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > INSTALLED_DOCUMENT_LIMITS.documentBytes)
    return fail('document_size');
  try {return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);}
  catch {return fail('utf8');}
}
export function installedDocumentDigest(bytes: Uint8Array): string {
  return `sha256-${bytesToHex(sha256(bytes))}`;
}

/** Split on Unicode scalar boundaries. No block is truncated or silently normalized. */
export function splitInstalledDocumentContent(content: string): readonly string[] {
  if (typeof content !== 'string' || !content.isWellFormed()) return fail('utf8');
  const blocks: string[] = [];
  let block = '', size = 0, total = 0;
  for (const scalar of content) {
    const point = scalar.codePointAt(0)!;
    const width = point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
    total += width;
    if (total > INSTALLED_DOCUMENT_LIMITS.documentBytes) return fail('document_size');
    if (size + width > INSTALLED_DOCUMENT_LIMITS.blockBytes) {
      blocks.push(block);block = '';size = 0;
    }
    block += scalar;size += width;
  }
  if (block || blocks.length === 0) blocks.push(block);
  if (blocks.length > INSTALLED_DOCUMENT_LIMITS.maxBlocks) return fail('block_count');
  return blocks;
}

export function installedDocumentMetadata(document: InstalledModuleDocument): InstalledModuleDocumentMetadata {
  const {content: _content, ...metadata} = document;
  return metadata;
}

export function verifyInstalledDocumentContent(metadata: InstalledModuleDocumentMetadata, content: string): boolean {
  try {
    const blocks = splitInstalledDocumentContent(content), bytes = encoder.encode(content);
    return bytes.byteLength === metadata.byteLength && blocks.length === metadata.blockCount
      && installedDocumentDigest(bytes) === metadata.digest;
  } catch {return false;}
}

export function readInstalledDocumentBlock(document: InstalledModuleDocument, blockIndex: number): InstalledModuleDocumentBlock {
  if (!Number.isSafeInteger(blockIndex) || blockIndex < 0) return fail('block_index');
  if (!verifyInstalledDocumentContent(document, document.content)) return fail('document_integrity');
  const blocks = splitInstalledDocumentContent(document.content);
  if (blockIndex >= blocks.length) return fail('block_index');
  return {document: installedDocumentMetadata(document), blockIndex, content: blocks[blockIndex],
    nextBlockIndex: blockIndex + 1 < blocks.length ? blockIndex + 1 : null};
}
