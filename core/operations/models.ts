import type { DataField, DataModel } from '../data/types.ts';

/** Host-owned technical records. This namespace is reserved, not an installable product module. */
export const OPERATION_STORAGE_MODULE_ID = 'creezio.runtime';
const text = (id: string, maxLength = 128, nullable = false): DataField => ({ id, type: 'string', nullable,
  protected: true, computed: false, constraints: { minLength: 1, maxLength } });
const integer = (id: string, nullable = false): DataField => ({ id, type: 'integer', nullable,
  protected: true, computed: false, constraints: { minimum: 0, maximum: Number.MAX_SAFE_INTEGER } });
const enumeration = (id: string, values: string[]): DataField => ({ ...text(id), constraints: { enum: values } });
const json = (id: string, nullable = false): DataField => ({ id, type: 'json', nullable, protected: true, computed: false });
const index = (id: string, fields: string[], unique = false) => ({ id, fields, unique });
const relation = (id: string, fields: string[], model: string, targetFields: string[]) => ({ id, fields,
  target: { moduleId: OPERATION_STORAGE_MODULE_ID, kind: 'model', id: model }, targetFields, onDelete: 'restrict' });
const model = (id: string, fields: DataField[], indexes: DataModel['indexes'], relations: DataModel['relations'] = []): DataModel => ({
  id, title: `Operation ${id}`, scope: 'application', fields, primaryKey: ['id'], indexes, relations,
  permissions: [], deletion: { mode: 'hard', requiresApproval: true }, public: false,
});
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}
export const OPERATION_MODELS: readonly DataModel[] = freeze([
  model('executions', [text('id'), text('scope_hash', 71), text('input_hash', 71), text('module_id'), text('operation_id'),
    text('operation_version'), text('actor_principal_id'), text('principal_id'), text('context_id'),
    enumeration('audience', ['admin', 'app']), enumeration('state', ['running', 'waiting', 'succeeded', 'failed', 'unknown']),
    json('output', true), text('error_code', 128, true), text('claim_nonce'), integer('attempt_number'),
    integer('created_at_ms'), integer('updated_at_ms'), integer('claim_expires_at_ms'), integer('retained_until_ms')],
  [index('scope', ['scope_hash'], true), index('context-state', ['context_id', 'state', 'updated_at_ms'])]),
  model('attempts', [text('id'), text('execution_id'), text('claim_nonce'), integer('number'),
    enumeration('state', ['running', 'succeeded', 'failed', 'unknown']), integer('created_at_ms'), integer('settled_at_ms', true)],
  [index('claim', ['claim_nonce'], true), index('execution-number', ['execution_id', 'number'], true)],
  [relation('execution', ['execution_id'], 'executions', ['id'])]),
  model('audit', [text('id'), text('execution_id'), text('attempt_nonce', 128, true), text('outbox_id', 128, true),
    enumeration('event', ['started', 'resumed', 'committed', 'failed', 'unknown', 'delivery-claimed', 'delivery-checkpointed', 'delivery-resumed', 'delivery-appended', 'delivery-succeeded', 'delivery-failed', 'delivery-unknown']),
    text('actor_principal_id'), text('principal_id'), text('context_id'), enumeration('audience', ['admin', 'app']),
    text('code', 128, true), integer('created_at_ms')], [index('execution-time', ['execution_id', 'created_at_ms'])],
  [relation('execution', ['execution_id'], 'executions', ['id'])]),
  model('outbox', [text('id'), text('execution_id'), text('intent_id'), text('provider'), text('provider_idempotency_key', 256),
    json('payload'), enumeration('state', ['queued', 'claimed', 'succeeded', 'failed', 'unknown']), json('receipt', true),
    text('claim_nonce', 128, true), integer('created_at_ms'), integer('updated_at_ms'), integer('claim_expires_at_ms', true)],
  [index('execution-intent', ['execution_id', 'intent_id'], true), index('delivery-claim', ['claim_nonce'], true),
    index('pending', ['state', 'updated_at_ms'])], [relation('execution', ['execution_id'], 'executions', ['id'])]),
  model('approvals', [text('id'),text('module_id'),text('operation_id'),text('operation_digest'),
    text('actor_principal_id'),text('principal_id'),text('context_id'),enumeration('audience',['admin','app']),
    text('credential_digest',71),text('input_hash',71),text('request_key_hash',71),json('preview'),
    text('object_version'),text('oauth_grant_id',128,true),text('oauth_client_id',128,true),
    enumeration('state',['pending','approved','rejected','consumed']),integer('expires_at_ms'),
    text('decision_session_id',128,true),text('csrf_digest',71,true),text('decision_nonce',128,true),
    integer('decided_at_ms',true),integer('consumed_at_ms',true),text('consumed_nonce',128,true),
    integer('created_at_ms'),integer('updated_at_ms')],
    [index('request',['module_id','operation_id','actor_principal_id','context_id','audience','request_key_hash'],true),
      index('actor-state',['actor_principal_id','context_id','audience','state','created_at_ms']),
      index('expiry',['expires_at_ms','state'])]),
]);
const hex = (value: string) => Array.from(new TextEncoder().encode(value), byte => byte.toString(16).padStart(2, '0')).join('');
export const OPERATION_TABLES = Object.freeze(Object.fromEntries(OPERATION_MODELS.map(model =>
  [model.id, `cz_${hex(OPERATION_STORAGE_MODULE_ID)}_${hex(model.id)}`])) as Record<'executions' | 'attempts' | 'audit' | 'outbox' | 'approvals', string>);
