import '../../../scripts/local-environment.mjs';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import { Miniflare } from 'miniflare';
import { generateD1Schema } from '../../../scripts/data/d1-schema.mjs';
import { createAccountService, provisionBootstrapCapability } from '../../../core/identity/accounts.ts';
import { createAuthorizationService } from '../../../core/authorization/service.ts';
import { createDataAccess } from '../../../core/data/service.ts';
import { ACCESS_TABLES } from '../../../core/identity/d1-store.ts';

export const moduleId = 'example.storage';
const ref = (kind, id) => ({ moduleId, kind, id });
const f = (id, type = 'string', constraints = {}) => ({ id, type, nullable: false, protected: true, computed: false, constraints });
const base = (id, fields, permission) => ({ id, title: id, scope: 'context', contextField: 'context_id',
  fields: [f('context_id'), ...fields], primaryKey: ['context_id', 'id'], indexes: [], relations: [],
  permissions: [ref('permission', permission)], deletion: { mode: 'hard', requiresApproval: false }, public: false });
export const category = { id: 'attachment', metadataModel: ref('model', 'file_metadata'), contextField: 'context_id', ownerField: 'owner_id',
  storageFields: { id: 'id', objectKey: 'object_key', digest: 'digest', byteSize: 'byte_size', contentType: 'content_type',
    filename: 'filename', version: 'version', state: 'state', intentId: 'intent_id', generation: 'generation' },
  mimeTypes: ['application/pdf', 'text/plain'], maxBytes: 100_000, public: false, permissions: [ref('permission', 'files')] };
export const vaultStorage = { moduleId, modelId: 'secret_metadata', contextField: 'context_id',
  fields: { id: 'id', bindingId: 'binding_id', ciphertext: 'ciphertext', keyId: 'key_id', version: 'version', state: 'state' } };
export const fileModel = base('file_metadata', [f('id'), f('owner_id'), f('object_key'), f('digest', 'string', { minLength: 64, maxLength: 64 }),
  f('byte_size', 'integer', { minimum: 0 }), f('content_type'), f('filename'), f('version', 'integer', { minimum: 1 }),
  f('state', 'string', { enum: ['staging', 'staged', 'available', 'abandoned', 'deleted'] }), f('intent_id'), f('generation')], 'records');
fileModel.indexes = [{ id: 'intent', fields: ['context_id', 'intent_id', 'generation'], unique: true },
  { id: 'object', fields: ['context_id', 'object_key'], unique: true }];
export const vaultModel = base('secret_metadata', [f('id'), f('binding_id'), f('ciphertext'), f('key_id'),
  f('version', 'integer', { minimum: 1 }), f('state', 'string', { enum: ['active', 'revoked'] })], 'secrets');
const business = base('record', [{ ...f('id'), protected: false }, { ...f('title'), protected: false }], 'records');
const models = [fileModel, vaultModel, business];
const definitions = [
  { id: 'records', resources: [ref('model', 'file_metadata'), ref('model', 'record')] },
  { id: 'files', resources: [ref('file', 'attachment')] },
  { id: 'restricted', resources: [ref('file', 'restricted')] },
  { id: 'secrets', resources: [ref('model', 'secret_metadata')] },
].map(p => ({ ...p, actions: ['read', 'create', 'update', 'delete'], audiences: ['admin', 'app'], actors: ['user'] }));
export const permissions = definitions.map(p => ({ id: `${moduleId}:${p.id}`, audiences: p.audiences, actors: p.actors }));
export const schema = generateD1Schema(moduleId, models);
// This synthetic fixture needs the canonical native Access tables in real D1.
// Product installation and composition-lock qualification have separate tests.
const accessModels=JSON.parse(readFileSync(new URL('../../../extensions/native/access/module/models.json',import.meta.url),'utf8'));
const accessSchema=generateD1Schema('creezio.access',accessModels);
assert.equal(Object.keys(accessSchema.tables).length,Object.keys(ACCESS_TABLES).length);
for(const [id,name] of Object.entries(ACCESS_TABLES))assert.equal(accessSchema.tables[id],name);
export const catalog = { schemaVersion: 1, compositionDigest: `sha256-${'f'.repeat(64)}`, modules: [{ moduleId,
  enabled: true, version: '1.0.0', permissions: definitions, models: models.map(model => ({ modelId: model.id, model, table: schema.tables[model.id] })) }] };
export const table = id => `"${schema.tables[id]}"`;
const good = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result; };

/** Real ephemeral D1/R2; authentication setup is internal, without any product provisioning route. */
export async function createStorageFixture() {
  const runtime = new Miniflare({ host: '127.0.0.1', port: 0, cf: false, modules: true, compatibilityDate: '2026-05-15',
    script: 'export default {fetch(){return new Response(null,{status:404})}}', d1Databases: { DB: 'creezio-storage-qualification' },
    r2Buckets: ['BUCKET'], d1Persist: false, r2Persist: false });
  try {
    const db = await runtime.getD1Database('DB'), bucket = await runtime.getR2Bucket('BUCKET');
    await db.batch([...accessSchema.statements, ...schema.statements].map(sql => db.prepare(sql)));
    const accounts = createAccountService(db), capability = await provisionBootstrapCapability(db);
    const password = 'Synthetic storage qualification password';
    const owner = good(await accounts.bootstrap({ token: capability.token, loginIdentifier: 'storage@example.invalid', displayName: 'Storage fixture', password }));
    const signed = good(await accounts.login({ loginIdentifier: 'storage@example.invalid', password, audience: 'admin' }));
    const acl = createAuthorizationService(db, { permissions }), current = good(await acl.readPolicy(signed.token));
    const policy = structuredClone(current.policy);
    policy.contexts.push({ id: 'other', status: 'active' });
    policy.memberships.push({ principalId: owner.principalId, contextId: 'other', audience: 'admin', status: 'active' });
    policy.roles.push({ id: 'storage', inherits: [], permissionIds: permissions.filter(p => !p.id.endsWith(':restricted')).map(p => p.id), permissionOverrides: [] });
    for (const contextId of ['application', 'other']) policy.assignments.push({ principalId: owner.principalId, contextId, audience: 'admin', roleId: 'storage' });
    good(await acl.replacePolicy(signed.token, { expectedEpoch: current.epoch, policy }));
    const data = createDataAccess(db, { catalog, permissions });
    return { runtime, db, bucket, accounts, signed, owner, data, catalog, category, vaultStorage,
      lease: (contextId = 'application', service = data) => service.authorize({ kind: 'session', token: signed.token },
        { contextId, audience: 'admin', actors: ['user'], requiredPermissionIds: [], purpose: 'operation' }, { moduleId }),
      async revoke() { await accounts.logout(signed.token, 'admin'); },
      async changePermissions(ids) {
        const current = good(await acl.readPolicy(signed.token)), policy = structuredClone(current.policy);
        policy.roles.find(role => role.id === 'storage').permissionIds = ids.map(id => `${moduleId}:${id}`);
        good(await acl.replacePolicy(signed.token, { expectedEpoch: current.epoch, policy }));
      },
      async bumpEpoch() { await db.prepare(`UPDATE "${ACCESS_TABLES.authorization_state}" SET epoch=epoch+1`).run(); },
      dispose: () => runtime.dispose(),
    };
  } catch (error) { await runtime.dispose(); throw error; }
}
