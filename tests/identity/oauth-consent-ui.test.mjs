import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {isConsentTransactionId, loadConsentPreview, parseConsentPreview} from '../../sdk/oauth/consent.ts';

const transactionId = 'VYVJFvWR6E2wg8xSMUQAcQ';
const preview = () => ({transactionId, clientName: 'Assistant de travail', redirectHost: 'client.example',
  resource: 'https://creezio.example/mcp/app', audience: 'app', contextId: 'application',
  permissions: [{id: 'crm.contact:read', title: 'Lire les contacts'},
    {id: 'crm.contact:write', title: 'Modifier les contacts'}],
  scopes: ['crm.contact:read', 'crm.contact:write'], expiresAtMs: 2_000_000_000_000,
  csrfToken: 'opaque-csrf-token', principal: {id: 'principal-1', displayName: 'Compte Creezio'}});
const json = (body, status = 200) => new Response(JSON.stringify(body),
  {status, headers: {'content-type': 'application/json; charset=utf-8'}});

test('preview transport fixes the same-origin read and rejects arbitrary response shapes', async () => {
  const calls = [];
  const ready = await loadConsentPreview(transactionId, async (url, options) => {
    calls.push({url, options}); return json(preview());
  });
  assert.equal(ready.kind, 'ready');
  assert.deepEqual(ready.preview.permissions.map(item => item.id), ['crm.contact:read', 'crm.contact:write']);
  assert.equal(calls[0].url, `/oauth/consent/${transactionId}/preview`);
  assert.equal(calls[0].options.credentials, 'same-origin');
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(calls[0].options.cache, 'no-store');
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(isConsentTransactionId('../bad'), false);
  assert.equal((await loadConsentPreview('../bad', () => assert.fail('No request'))).kind, 'unavailable');
  assert.equal(parseConsentPreview({...preview(), redirectUri: 'https://evil.example'}, transactionId), null);
  assert.equal(parseConsentPreview({...preview(), transactionId: 'another-transaction-id'}, transactionId), null);
  assert.equal(parseConsentPreview({...preview(), permissions: [{id: 'crm.contact:read', title: 'Read'},
    {id: 'crm.contact:read', title: 'Read again'}]}, transactionId), null);
  assert.deepEqual(parseConsentPreview({...preview(), permissions: []}, transactionId)?.permissions, []);
  assert.deepEqual(parseConsentPreview({...preview(), permissions: [], scopes: []}, transactionId)?.scopes, []);
});

test('preview requires a verified audience for native sign-in and fails closed on redirects', async () => {
  assert.deepEqual(await loadConsentPreview(transactionId,
    async () => json({error: {code: 'authentication_required'}, audience: 'app'}, 401)),
  {kind: 'sign_in', audience: 'app'});
  assert.equal((await loadConsentPreview(transactionId,
    async () => json({error: {code: 'authentication_required'}}, 401))).kind, 'unavailable');
  assert.equal((await loadConsentPreview(transactionId,
    async () => Response.redirect('https://client.example/code'))).kind, 'unavailable');
  assert.equal((await loadConsentPreview(transactionId,
    async () => json({error: {code: 'not_found'}}, 404))).kind, 'expired');
});

const require = createRequire(import.meta.url);
const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../../extensions/native/access/ui/consent.tsx', import.meta.url))],
  bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022', logLevel: 'silent',
  plugins: [{name: 'installed-react', setup(builder) {
    builder.onResolve({filter: /^react(?:\/|$)/}, args =>
      ({path: pathToFileURL(require.resolve(args.path)).href, external: true}));
    builder.onResolve({filter: /\.css$/}, args => ({path: args.path, namespace: 'test-css'}));
    builder.onLoad({filter: /.*/, namespace: 'test-css'}, () => ({contents: '', loader: 'js'}));
  }}],
});
const script = bundle.outputFiles[0]?.text;
assert.ok(script);
const {ConsentCard} = await import(`data:text/javascript;base64,${Buffer.from(script).toString('base64')}`);
const render = (value, nowMs = 1_999_999_999_000) =>
  renderToStaticMarkup(createElement(ConsentCard, {preview: value, nowMs}));

test('consent card shows exact context, rights and account; native POST contains no client redirect', () => {
  const html = render(preview());
  assert.match(html, /Compte Creezio/);
  assert.match(html, /application/);
  assert.match(html, /Lire les contacts/);
  assert.match(html, /Modifier les contacts/);
  assert.match(html, /crm.contact:read/);
  assert.match(html, /client.example/);
  assert.match(html, /action="\/oauth\/consent\/VYVJFvWR6E2wg8xSMUQAcQ" method="post"/);
  assert.match(html, /name="csrfToken" value="opaque-csrf-token"/);
  assert.equal([...html.matchAll(/name="permissionIds"/g)].length, 2);
  assert.match(html, /value="deny" name="decision"/);
  assert.match(html, /value="approve" name="decision"/);
  assert.doesNotMatch(html, /name="(?:redirect_uri|state|client_id|scope)"/);
});

test('untrusted labels are escaped and expired consent cannot be submitted', () => {
  const value = {...preview(), clientName: '<script>alert(1)</script>',
    permissions: [{id: 'crm.contact:read', title: '<img src=x>'}]};
  const html = render(value, value.expiresAtMs);
  assert.doesNotMatch(html, /<script>|<img/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;img src=x&gt;/);
  assert.equal([...html.matchAll(/<button[^>]*disabled=""/g)].length, 2);
});

test('a valid request with no effective permission can be approved without a business grant', () => {
  const html = render({...preview(), permissions: []});
  assert.match(html, /Aucune permission demandée n’est disponible/);
  assert.match(html, /Aucune permission métier ne sera accordée/);
  assert.match(html, /value="deny" name="decision"/);
  assert.match(html, /value="approve" name="decision"/);
  assert.doesNotMatch(html, /name="permissionIds"/);
});

test('an empty OAuth scope still permits explicit consent with zero permission IDs', () => {
  const value = {...preview(), scopes: [], permissions: []};
  const html = render(value);
  assert.match(html, /Aucune permission métier ne sera accordée/);
  assert.match(html, /value="approve" name="decision"/);
  assert.doesNotMatch(html, /name="permissionIds"|Portées techniques demandées/);
});
