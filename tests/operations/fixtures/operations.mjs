import { readFileSync } from 'node:fs';
import { contractIntegrity } from '../../../sdk/contracts/validate.mjs';

export const moduleId = 'example.operations';
export const ref = (kind, id) => ({ moduleId, kind, id });
export const actors = ['user', 'machine', 'impersonated-user'];
const text = { type: 'string', minLength: 1, maxLength: 128 };
const title = { type: 'string', minLength: 1, maxLength: 200 };
const version = { type: 'integer', minimum: 0, maximum: 1_000_000 };
const object = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
export const schemas = [
  { id: 'read-input', schema: object({ id: text }) },
  { id: 'create-input', schema: object({ id: text, title, request_id: text }) },
  { id: 'rename-input', schema: object({ id: text, title, request_id: text, record_version: version }) },
  { id: 'send-input', schema: object({ id: text, request_id: text }) },
  { id: 'record-output', schema: object({ id: text, title, revision: version }) },
  { id: 'send-output', schema: object({ accepted: { type: 'boolean' } }) },
];
const field = (id, type = 'string', extra = {}) => ({ id, type, nullable: false, protected: false, computed: false, ...extra });
export const models = [{ id: 'record', title: 'Synthetic operation record', scope: 'context', contextField: 'context_id',
  fields: [field('context_id', 'string', { protected: true }), field('id'), field('title', 'string', { constraints: { minLength: 1, maxLength: 200 } }),
    field('revision', 'integer', { constraints: { minimum: 0, maximum: 1_000_000 } }),
    field('internal_secret', 'string', { protected: true, default: 'synthetic protected model value' })],
  primaryKey: ['context_id', 'id'], indexes: [], relations: [], permissions: [ref('permission', 'read'), ref('permission', 'edit')],
  deletion: { mode: 'hard', requiresApproval: false }, public: false }];
export const permissionDeclarations = [
  { id: 'read', actions: ['read'], actors },
  { id: 'edit', actions: ['read', 'create', 'update', 'delete'], actors },
  { id: 'provider', actions: ['read', 'execute'], actors },
  { id: 'approve', actions: ['approve'], actors: ['user'] },
].map(permission => ({ ...permission, title: permission.id, audiences: ['admin', 'app'], scopes: [], context: 'required',
  default: 'deny', resources: [ref('model', 'record')], enforcement: { request: true, commit: true }, public: false }));
export const permissions = permissionDeclarations.map(permission => ({ id: `${moduleId}:${permission.id}`, audiences: permission.audiences, actors: permission.actors }));
function operation(id, kind, input, output, permission, extra = {}) {
  return { id, title: id, kind, input: { schemaId: input }, output: { schemaId: output },
    permissions: [ref('permission', permission)], audiences: ['admin', 'app'], actors, context: 'required',
    handler: { path: 'module/operations.ts', export: id },
    effects: { reads: [ref('model', 'record')], writes: [], emits: [], calls: [], providers: [] },
    errors: [{ code: 'rejected', retryable: false, outcome: 'rejected' }, { code: 'effect-unknown', retryable: false, outcome: 'unknown' }],
    pagination: { mode: 'none' }, idempotency: kind === 'command'
      ? { mode: 'required', keyField: 'request_id', scope: 'actor-context-operation', retentionSeconds: 86400 } : { mode: 'none' },
    approval: { mode: 'none' }, concurrency: { mode: 'none' },
    execution: { maxDurationMs: 1000, maxItems: 10, resumable: false }, audit: { required: true, redactFields: ['title'] }, public: false, ...extra };
}
export const operations = [
  operation('read_record', 'query', 'read-input', 'record-output', 'read'),
  operation('create_record', 'command', 'create-input', 'record-output', 'edit', {
    effects: { reads: [], writes: [ref('model', 'record')], emits: [], calls: [], providers: [] } }),
  operation('rename_record', 'command', 'rename-input', 'record-output', 'edit', {
    effects: { reads: [ref('model', 'record')], writes: [ref('model', 'record')], emits: [], calls: [], providers: [] },
    concurrency: { mode: 'object-version', versionField: 'record_version' } }),
  operation('send_record', 'command', 'send-input', 'send-output', 'provider', {
    effects: { reads: [ref('model', 'record')], writes: [], emits: [], calls: [], providers: ['synthetic-provider'] } }),
  operation('approved_rename', 'command', 'rename-input', 'record-output', 'edit', {
    effects: { reads: [ref('model', 'record')], writes: [ref('model', 'record')], emits: [], calls: [], providers: [] },
    concurrency: { mode: 'object-version', versionField: 'record_version' },
    approval: { mode: 'required', permission: ref('permission', 'approve'),
      bind: ['actor', 'context', 'operation', 'input-hash', 'object-version'], expiresAfterSeconds: 300 } }),
  operation('invalid_output', 'query', 'read-input', 'record-output', 'read'),
  operation('query_write_attempt', 'query', 'read-input', 'record-output', 'read'),
];
const json = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));

/** Structural descriptors only: these package digests are fixture placeholders, not produced archives. */
export function operationComposition() {
  const descriptor = json('../../contracts/fixtures/valid-module.json');
  descriptor.identity.id = moduleId;
  descriptor.identity.origin = 'https://example.invalid/operations';
  descriptor.dependencies = [];
  descriptor.contracts = { schemas: structuredClone(schemas), models: structuredClone(models), files: [], operations: structuredClone(operations),
    permissions: structuredClone(permissionDeclarations), events: [], settings: [], search: [], api: [],
    mcp: { tools: [], resources: [], prompts: [], skills: [] }, ui: { views: [], navigation: [], slots: [], styles: [],
      front: { mode: 'absent', justification: { reason: 'Synthetic service fixture without a UI.', policyRule: 'fixture.no-ui' } } }, widgets: [], publicContracts: [] };
  descriptor.lifecycle.absent = { files: { reason: 'This synthetic operation fixture has no file capability.', policyRule: 'fixture.no-files' },
    widgets: { reason: 'This fixture tests the canonical service before widget transports.', policyRule: 'fixture.no-widgets' } };
  descriptor.packaging.validationBinding.moduleId = moduleId;
  const composition = json('../../contracts/fixtures/valid-composition.json');
  composition.modules = [{ moduleId, origin: descriptor.identity.origin, versionRange: '^1.0.0',
    source: { kind: 'workspace', path: 'tests/operations/fixtures' }, enabled: true, configuration: [], integrations: [] }];
  composition.exposure.admin.moduleIds = [moduleId]; composition.exposure.app.moduleIds = [moduleId];
  const lock = json('../../contracts/fixtures/valid-composition-lock.json');
  lock.modules[0] = { ...lock.modules[0], moduleId, origin: descriptor.identity.origin,
    contractIntegrity: contractIntegrity(descriptor), dependencies: [] };
  lock.compositionIntegrity = contractIntegrity(composition);
  return { composition, modules: [descriptor], lock };
}
