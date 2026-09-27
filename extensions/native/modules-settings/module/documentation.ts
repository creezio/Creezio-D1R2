/** Read the exact installed runtime documents captured by the host at composition. */
import {OperationError, type OperationContext, type OperationHandlerResult,
  type JsonValue} from '../../../../sdk/operations/handler.ts';
import {contractIntegrity} from '../../../../sdk/contracts/semantics.mjs';
import {installedDocumentMetadata, readInstalledDocumentBlock,
  type InstalledModuleDocument, type InstalledDocumentKind} from '../../../../sdk/modules/documents.ts';
import type {ModuleSettingsHostInventory, ModuleDocumentList,
  ModuleDocumentBlock} from '../../../../sdk/module-settings/types.ts';

type Row = Readonly<Record<string, unknown>>;
type Context = OperationContext & {readonly hostInventory?: ModuleSettingsHostInventory};
const id = (value: unknown): value is string => typeof value === 'string'
  && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
const digest = (value: unknown): value is string => typeof value === 'string'
  && /^sha256-[a-f0-9]{64}$/.test(value);
const kinds: readonly InstalledDocumentKind[] = ['readme', 'prd', 'changelog'];
function request(input: JsonValue): Row {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new OperationError('invalid_input');
  return input as Row;
}
function host(context: OperationContext): ModuleSettingsHostInventory {
  const inventory = (context as Context).hostInventory;
  if (!inventory || !Array.isArray(inventory.currentInstalledDocuments)
    || !inventory.current?.composition || !inventory.current?.lock) throw new OperationError('unavailable');
  return inventory;
}
function documents(inventory: ModuleSettingsHostInventory, moduleId: string): readonly InstalledModuleDocument[] {
  const found = inventory.currentInstalledDocuments.filter(document => document.moduleId === moduleId);
  if (!found.length) throw new OperationError('not_found');
  if (found.length !== 3 || new Set(found.map(document => document.kind)).size !== 3
    || found.some(document => !kinds.includes(document.kind))) throw new OperationError('unavailable');
  return kinds.map(kind => found.find(document => document.kind === kind)!);
}
export function documentsList(input: JsonValue, context: OperationContext): OperationHandlerResult {
  const moduleId = request(input).moduleId;
  if (!id(moduleId)) throw new OperationError('invalid_input');
  const inventory = host(context), selected = documents(inventory, moduleId);
  const output: ModuleDocumentList = {moduleId,
    documents: selected.map(installedDocumentMetadata),
    compositionDigest: contractIntegrity(inventory.current.composition),
    lockDigest: contractIntegrity(inventory.current.lock)};
  return {output};
}
export function documentsRead(input: JsonValue, context: OperationContext): OperationHandlerResult {
  const args = request(input);
  if (!id(args.moduleId) || !kinds.includes(args.kind as InstalledDocumentKind)
    || !digest(args.digest) || !digest(args.runtimeIntegrity)
    || !Number.isSafeInteger(args.blockIndex) || Number(args.blockIndex) < 0
    || Number(args.blockIndex) >= 8) throw new OperationError('invalid_input');
  const document = documents(host(context), args.moduleId).find(item => item.kind === args.kind)!;
  if (document.digest !== args.digest || document.runtimeIntegrity !== args.runtimeIntegrity)
    throw new OperationError('conflict');
  if (Number(args.blockIndex) >= document.blockCount) throw new OperationError('invalid_input');
  try {
    const output: ModuleDocumentBlock = readInstalledDocumentBlock(document, Number(args.blockIndex));
    return {output};
  } catch { throw new OperationError('unavailable'); }
}
