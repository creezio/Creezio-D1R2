import test from 'node:test';
import assert from 'node:assert/strict';
import {sandboxProfileHeaders} from '../../../../../sdk/widgets/proxy/profile-policy.mjs';
import {validWidgetMessageContent} from '../../../../../sdk/widgets/validation.ts';
import {createWidgetApprovalClient} from '../../../../../sdk/widgets/approval-client.ts';
import {widgetActionJournal, widgetApprovalJournal, widgetOperationInput, recordWidgetApprovalId}
  from '../../../../../sdk/widgets/action-journal.ts';

const profile = 'sha256-' + 'a'.repeat(64);
const resourceDigest = 'sha256-' + 'b'.repeat(64);
const content = {
  kind: 'creezio.widget-message', schemaVersion: 1,
  instances: [{instanceId: 'wi_1', instanceRevision: 1, moduleId: 'example.catalog',
    widgetId: 'comparison', widgetVersion: '1.0.0',
    resourceUri: `ui://creezio/example.catalog/comparison/1.0.0/${resourceDigest}.html`,
    resourceDigest, state: {selectedIds: ['a', 'b']}}],
};

test('widget snapshot accepts a pinned multi-instance message and rejects identity substitution', () => {
  assert.equal(validWidgetMessageContent(content), true);
  assert.equal(validWidgetMessageContent({...content, instances: [...content.instances,
    {...content.instances[0], instanceId: 'wi_2'}]}), true);
  assert.equal(validWidgetMessageContent({...content, instances: [...content.instances,
    {...content.instances[0]}]}), false);
  assert.equal(validWidgetMessageContent({...content, instances: [{...content.instances[0],
    resourceUri: 'ui://creezio/example.catalog/comparison/1.0.0/other.html'}]}), false);
  assert.equal(validWidgetMessageContent({...content, instances: [{...content.instances[0],
    state: {oversized: 'x'.repeat(4096)}}]}), false);
  assert.equal(validWidgetMessageContent({...content, instances: [{...content.instances[0],
    renderExecution: {moduleId: 'example.catalog', operationId: 'read',
      operationDigest: resourceDigest, executionId: 'exec_1'}}]}), true);
  assert.equal(validWidgetMessageContent({...content, instances: [{...content.instances[0],
    renderExecution: {moduleId: 'example.catalog', operationId: 'read',
      operationDigest: 'wrong', executionId: 'exec_1'}}]}), false);
});

test('sandbox headers keep undeclared network/frame origins blocked and exact host framing', () => {
  const headers = sandboxProfileHeaders({cspProfileId: profile,
    csp: {connectDomains: [], resourceDomains: [], frameDomains: [], baseUriDomains: []},
    hostOrigins: ['https://app.example.test']});
  assert.match(headers['Content-Security-Policy'], /connect-src 'none'/);
  assert.match(headers['Content-Security-Policy'], /frame-src 'none'/);
  assert.match(headers['Content-Security-Policy'], /frame-ancestors https:\/\/app\.example\.test/);
  assert.match(headers['Content-Security-Policy'], /form-action 'none'/);
  assert.equal(headers['Cache-Control'], 'no-cache');
  assert.throws(() => sandboxProfileHeaders({cspProfileId: profile,
    csp: {connectDomains: ["https://safe.example;script-src 'unsafe-eval'"]},
    hostOrigins: ['https://app.example.test']}));
  assert.throws(() => sandboxProfileHeaders({cspProfileId: profile, csp: {},
    hostOrigins: ['http://app.example.test']}));
  const declared = sandboxProfileHeaders({cspProfileId: profile,
    csp: {resourceDomains: ['https://*.assets.example.test'],
      connectDomains: ['wss://stream.example.test']}, hostOrigins: ['https://app.example.test']});
  assert.match(declared['Content-Security-Policy'], /script-src[^;]*https:\/\/\*\.assets\.example\.test/);
  assert.match(declared['Content-Security-Policy'], /connect-src wss:\/\/stream\.example\.test/);
});

test('approval decision stays on native session and rejects a changed session', async () => {
  const origin = 'https://app.example.test';
  const first = {id: 'session_1', principalId: 'person_1', audience: 'admin'};
  let session = first, sent;
  const access = {origin, audience: 'admin', getSnapshot: () =>
    ({phase: 'authenticated', pending: null, session})};
  const approvalId = 'approval_1', csrfNonce = 'nonce_1';
  const preview = {approvalId, state: 'pending', expiresAtMs: Date.now() + 60_000,
    operation: {moduleId: 'example.catalog', operationId: 'update', title: 'Modifier'},
    fields: {item: 'A'}, inputDigest: `sha256:${'a'.repeat(64)}`, csrfNonce,
    sessionId: first.id, principalId: first.principalId, contextId: 'workspace'};
  const fetcher = async (url, options) => {
    sent = {url, options};
    return new Response(JSON.stringify(url.endsWith('/decide')
      ? {approvalId, state: 'approved', expiresAtMs: preview.expiresAtMs} : preview),
    {headers: {'content-type': 'application/json'}});
  };
  const client = createWidgetApprovalClient({origin, audience: 'admin', contextId: 'workspace',
    access, fetcher});
  const read = await client.read(approvalId);
  assert.equal(read.kind, 'ok');
  const decided = await client.decide(read.value, 'approve');
  assert.equal(decided.kind, 'ok');
  assert.deepEqual(JSON.parse(sent.options.body), {decision: 'approve', csrfNonce});
  assert.equal(sent.options.credentials, 'same-origin');
  session = {id: 'session_2', principalId: 'person_1', audience: 'admin'};
  assert.equal((await client.decide(read.value, 'approve')).kind, 'rejected');
});

test('widget query input stays exact and a command journals its canonical key before dispatch', () => {
  const args = {id: 'alpha', request_key: 'iframe-controlled'};
  assert.deepEqual(widgetOperationInput({operationKind: 'query', idempotencyKeyField: null},
    {id: args.id}, 'host-key'), {id: 'alpha'});
  assert.deepEqual(widgetOperationInput({operationKind: 'command', idempotencyKeyField: 'request_key'},
    args, 'host-key'), {id: 'alpha', request_key: 'host-key'});
  assert.equal(widgetOperationInput({operationKind: 'command', idempotencyKeyField: null},
    args, 'host-key'), null);
  const entries = new Map();
  const storage = {getItem: key => entries.get(key) ?? null,
    setItem: (key, value) => {entries.set(key, value);}, removeItem: key => {entries.delete(key);}};
  const scope = {sessionId: 'session_1', principalId: 'person_1', audience: 'admin',
    contextId: 'workspace', conversationId: 'conversation_1', messageId: 'message_1',
    instanceId: 'instance_1', instanceRevision: 1};
  const journal = widgetActionJournal(scope, storage);
  const pending = {bindingId: 'example.widgets-witness:record-rename-admin',
    operationDigest: resourceDigest, toolName: 'rename_record', requestKey: 'host-key'};
  assert.equal(journal.write(pending), true);
  assert.deepEqual(widgetActionJournal(scope, storage).read(), pending);
  assert.equal(widgetActionJournal({...scope, sessionId: 'session_2'}, storage).read(), null);
  journal.clear();
  assert.equal(journal.read(), null);
});

test('approval journal retains the request key and input for an idempotent native recovery', () => {
  const entries = new Map();
  const storage = {getItem: key => entries.get(key) ?? null,
    setItem: (key, value) => {entries.set(key, value);}, removeItem: key => {entries.delete(key);}};
  const scope = {sessionId: 'session_1', principalId: 'person_1', audience: 'admin',
    contextId: 'workspace', conversationId: 'conversation_1', messageId: 'message_1',
    instanceId: 'instance_1', instanceRevision: 1};
  const journal = widgetApprovalJournal(scope, storage);
  const draft = {bindingId: 'example.widgets-witness:record-rename-admin',
    operationDigest: resourceDigest, toolName: 'rename_record', requestKey: 'host-key',
    moduleId: 'example.widgets-witness', operationId: 'rename_record',
    input: {id: 'alpha', title: 'Updated', revision: 1, request_key: 'host-key'}};
  assert.equal(journal.write(draft), true);
  assert.deepEqual(widgetApprovalJournal(scope, storage).read(), draft);
  assert.equal(journal.write({...draft, approvalId: 'approval_1'}), true);
  assert.equal(journal.read().approvalId, 'approval_1');
  assert.equal(journal.write({...draft, input: {...draft.input, secretToken: 'unsafe'}}), false);
  assert.equal(journal.read().approvalId, 'approval_1');
  assert.equal(widgetApprovalJournal({...scope, contextId: 'other'}, storage).read(), null);
  journal.clear();
  assert.equal(journal.read(), null);
});

test('a quota failure on the grant ID keeps the draft and blocks any decision preview', () => {
  const entries = new Map();
  let writes = 0;
  const storage = {getItem: key => entries.get(key) ?? null,
    setItem: (key, value) => {if (++writes === 2) throw new Error('QuotaExceededError');
      entries.set(key, value);}, removeItem: key => {entries.delete(key);}};
  const scope = {sessionId: 'session_1', principalId: 'person_1', audience: 'admin',
    contextId: 'workspace', conversationId: 'conversation_1', messageId: 'message_1',
    instanceId: 'instance_1', instanceRevision: 1};
  const journal = widgetApprovalJournal(scope, storage);
  const draft = {bindingId: 'example.widgets-witness:record-rename-admin',
    operationDigest: resourceDigest, toolName: 'rename_record', requestKey: 'host-key',
    moduleId: 'example.widgets-witness', operationId: 'rename_record',
    input: {id: 'alpha', title: 'Updated', revision: 1, request_key: 'host-key'}};
  assert.equal(journal.write(draft), true);
  const decisionReady = recordWidgetApprovalId(journal,draft,'approval_1');
  assert.equal(decisionReady,null);
  assert.deepEqual(journal.read(),draft);
  assert.equal(writes,2);
});
