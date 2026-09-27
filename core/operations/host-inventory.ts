import {copyJson} from '../data/input.ts';
import {OperationError} from './types.ts';
import {contractIntegrity} from '../../sdk/contracts/semantics.mjs';
import type {ModuleSettingsHostInventory} from '../../sdk/module-settings/types.ts';

const moduleId = 'creezio.modules-settings';
const origin = 'https://github.com/creezio/Creezio-D1R2';
const sourcePath = 'extensions/native/modules-settings';

/** Static host configuration only. A request or a module cannot supply this capability. */
export function captureHostInventory(value: ModuleSettingsHostInventory | undefined, compositionDigest: string) {
  if (value === undefined) return undefined;
  try {
    const captured = copyJson(value, 4 * 1024 * 1024) as unknown as ModuleSettingsHostInventory;
    const {current, inventory} = captured;
    if (contractIntegrity(current.composition) !== compositionDigest || inventory.schemaVersion !== 1
      || contractIntegrity({schemaVersion: 1, candidates: inventory.candidates}) !== inventory.digest
      || !Array.isArray(current.composition.modules) || !Array.isArray(current.descriptors)) throw new Error();
    const selection = current.composition.modules.find(item => item.moduleId === moduleId);
    const descriptor = current.descriptors.find(item => (item.identity as Record<string, unknown>)?.id === moduleId);
    const identity = descriptor?.identity as Record<string, unknown> | undefined;
    if (!selection?.enabled || selection.origin !== origin || selection.source?.kind !== 'workspace'
      || selection.source.path !== sourcePath || identity?.origin !== origin || identity?.publisher !== 'creezio') throw new Error();
    const candidate = inventory.candidates.find(item => item.moduleId === moduleId && item.origin === origin
      && item.version === identity.version && item.source.kind === 'workspace' && item.source.path === sourcePath);
    if (!candidate || contractIntegrity(candidate.descriptor) !== contractIntegrity(descriptor)) throw new Error();
    return captured;
  } catch { throw new OperationError('invalid_catalog'); }
}
