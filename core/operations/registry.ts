import { copyJson } from '../data/input.ts';
import { OPERATION_LIMITS, OperationError, type OperationValidators,
  type RegisteredOperation, type RuntimeOperationCatalog } from './types.ts';

const canonicalId = (value: unknown): value is string => typeof value === 'string' && value.length <= 128
  && /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.exec(value)?.[0] === value;
const ownFunctions = (input: object): Readonly<Record<string, Function>> => {
  if (!input || typeof input !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) throw new OperationError('invalid_catalog');
  const descriptors = Object.getOwnPropertyDescriptors(input), result: Record<string, Function> = Object.create(null);
  if (Reflect.ownKeys(descriptors).length > OPERATION_LIMITS.operations * 16) throw new OperationError('invalid_catalog');
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== 'string' || !descriptors[key].enumerable || !Object.hasOwn(descriptors[key], 'value')
      || typeof descriptors[key].value !== 'function' || ['constructor', '__proto__', 'prototype'].includes(key)) throw new OperationError('invalid_catalog');
    result[key] = descriptors[key].value;
  }
  return Object.freeze(result);
};

/** Host-only immutable registry built from reviewed static imports. It grants no identity or permission. */
export function createOperationRegistry(options: { readonly catalog: RuntimeOperationCatalog;
  readonly validators: OperationValidators; readonly handlers: Readonly<Record<string, unknown>> }) {
  let catalog: RuntimeOperationCatalog;
  try { catalog = copyJson(options.catalog, OPERATION_LIMITS.catalogBytes) as unknown as RuntimeOperationCatalog; }
  catch { throw new OperationError('invalid_catalog'); }
  const validators = ownFunctions(options.validators), handlers = ownFunctions(options.handlers);
  const entries = new Map<string, RegisteredOperation>(), moduleIds = new Set<string>(), handlerNames = new Set<string>();
  let operationCount = 0;
  try {
    if (catalog.schemaVersion !== 1 || !/^sha256-[0-9a-f]{64}$/.test(catalog.compositionDigest)
      || !Array.isArray(catalog.modules) || catalog.modules.length > OPERATION_LIMITS.operations) throw new Error();
    for (const module of catalog.modules) {
      if (!canonicalId(module.moduleId) || moduleIds.has(module.moduleId) || typeof module.enabled !== 'boolean'
        || typeof module.version !== 'string' || !Array.isArray(module.operations) || !Array.isArray(module.schemas)) throw new Error();
      moduleIds.add(module.moduleId);
      const schemas = new Map<string, string>(), operations = new Set<string>();
      for (const schema of module.schemas) {
        if (!canonicalId(schema.schemaId) || schemas.has(schema.schemaId) || typeof validators[schema.validator] !== 'function') throw new Error();
        schemas.set(schema.schemaId, schema.validator);
      }
      for (const entry of module.operations) {
        const op = entry.operation, name = `${module.moduleId}:${op.id}`;
        if (++operationCount > OPERATION_LIMITS.operations || !canonicalId(op.id) || operations.has(op.id)
          || !/^sha256-[0-9a-f]{64}$/.test(entry.contractDigest)
          || typeof entry.active !== 'boolean' || entry.active && !module.enabled
          || schemas.get(op.input.schemaId) !== entry.inputValidator || schemas.get(op.output.schemaId) !== entry.outputValidator
          || (op.execution.progressSchema ? schemas.get(op.execution.progressSchema.schemaId) !== entry.progressValidator : entry.progressValidator !== undefined)
          || !['query', 'command'].includes(op.kind) || !['application', 'required'].includes(op.context)
          || !Array.isArray(op.audiences) || !op.audiences.length || op.audiences.some((a: unknown) => !['admin', 'app'].includes(String(a)))
          || !Array.isArray(op.actors) || !op.actors.length || !Array.isArray(op.permissions)
          || !Array.isArray(op.effects.reads) || !Array.isArray(op.effects.writes) || !Array.isArray(op.effects.calls)
          || !Array.isArray(op.effects.providers) || !Array.isArray(op.effects.emits)
          || op.kind === 'query' && (op.effects.writes.length || op.effects.emits.length || op.approval.mode !== 'none')
          || op.audit.required !== true || !['none', 'required'].includes(op.approval.mode)
          || !['none', 'required'].includes(op.idempotency.mode)
          || op.kind === 'command' && (op.effects.writes.length || op.effects.emits.length || op.effects.providers.length) && op.idempotency.mode !== 'required'
          || !Number.isSafeInteger(op.execution.maxDurationMs) || op.execution.maxDurationMs < 1
          || op.execution.maxDurationMs > OPERATION_LIMITS.maxDurationMs) throw new Error();
        operations.add(op.id);
        if (!entry.active) continue;
        if (typeof handlers[name] !== 'function') throw new Error();
        handlerNames.add(name);
        entries.set(name, Object.freeze({ moduleId: module.moduleId, moduleVersion: module.version, contractDigest: entry.contractDigest, declaration: op,
          validateInput: validators[entry.inputValidator], validateOutput: validators[entry.outputValidator], handler: handlers[name] }) as RegisteredOperation);
      }
    }
    if (Object.keys(handlers).some(name => !handlerNames.has(name))) throw new Error();
  } catch { throw new OperationError('invalid_catalog'); }
  return Object.freeze({ compositionDigest: catalog.compositionDigest, catalog,
    resolve(moduleId: string, operationId: string): RegisteredOperation {
      if (!canonicalId(moduleId) || !canonicalId(operationId)) throw new OperationError('not_found');
      const operation = entries.get(`${moduleId}:${operationId}`);
      if (!operation) throw new OperationError('not_found');
      return operation;
    },
  });
}
export type OperationRegistry = ReturnType<typeof createOperationRegistry>;
