import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { createElement, Fragment } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
// Compile only in memory. Share the installed React instance with the renderer,
// without a second dependency tree, temporary checkout or DOM emulation.
const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../../sdk/access/components.tsx', import.meta.url))],
  bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022', logLevel: 'silent',
  plugins: [{ name: 'installed-react', setup(builder) {
    builder.onResolve({ filter: /^react(?:\/|$)/ }, args => ({ path: pathToFileURL(require.resolve(args.path)).href, external: true }));
  } }],
});
const { LoginForm, NativeAccessPanel } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const render = (Component, props) => renderToStaticMarkup(createElement(Component, props));
const submit = async () => assert.fail('Server rendering must not submit');

test('login forms preserve native labels, autocomplete and unique IDs without rendering a secret value', () => {
  const html = renderToStaticMarkup(createElement(Fragment, null,
    createElement(LoginForm, { audience: 'admin', onSubmit: submit }),
    createElement(LoginForm, { audience: 'app', onSubmit: submit })));
  const inputs = [...html.matchAll(/<input\b[^>]+>/g)].map(match => match[0]);
  assert.equal(inputs.length, 4);
  const ids = inputs.map(input => /\bid="([^"]+)"/.exec(input)[1]);
  assert.equal(new Set(ids).size, 4);
  for (const id of ids) assert.ok(html.includes(`for="${id}"`), 'Each input has its own visible label');
  for (const input of inputs) {
    assert.match(input, /\brequired=""/);
    assert.doesNotMatch(input, /\bvalue=/);
  }
  assert.equal(inputs.filter(input => /autoComplete="username"/.test(input)).length, 2);
  assert.equal(inputs.filter(input => /autoComplete="current-password"/.test(input)).length, 2);
  assert.match(html, /type="submit"/);
  assert.doesNotMatch(html, /type="checkbox"|forgot|Rester connecté|récupération|factory|\/api\//i);
});

test('form errors are predefined, linked to both fields and do not expose unexpected diagnostics', () => {
  const html = render(LoginForm, { audience: 'admin', error: 'invalid_credentials', onSubmit: submit });
  const errorId = /<p id="([^"]+)" class="creezio-access-error" role="alert"/.exec(html)?.[1];
  assert.ok(errorId);
  const inputs = [...html.matchAll(/<input\b[^>]+>/g)].map(match => match[0]);
  for (const input of inputs) {
    assert.ok(input.includes(`aria-describedby="${errorId}"`));
    assert.match(input, /aria-invalid="true"/);
  }
  assert.match(html, /L’identifiant ou le mot de passe est incorrect/);
  const unexpected = render(LoginForm, { audience: 'app', error: 'provider raw diagnostic', onSubmit: submit });
  assert.doesNotMatch(unexpected, /provider raw diagnostic/);
  assert.match(unexpected, /Le service est indisponible/);
  assert.doesNotMatch(unexpected, /aria-invalid="true"/);
});

test('external pending state disables the native fieldset and submit control', () => {
  const html = render(LoginForm, { audience: 'app', disabled: true, onSubmit: submit });
  assert.match(html, /<form\b[^>]*aria-busy="true"/);
  assert.match(html, /<fieldset disabled=""/);
  assert.match(html, /<button\b[^>]*type="submit"[^>]*disabled=""/);
});

test('panel SSR is loading only and never reads an injected controller or fabricates a verified identity', () => {
  let reads = 0;
  const forbidden = () => { reads++; throw new Error('Unexpected server-side controller use'); };
  for (const audience of ['admin', 'app']) {
    const controller = { audience, origin: 'https://creezio.example', getSnapshot: forbidden,
      subscribe: forbidden, refresh: forbidden, login: forbidden, logout: forbidden, dispose: forbidden };
    const html = render(NativeAccessPanel, { audience, controller });
    assert.match(html, /Vérification de votre session/);
    assert.match(html, /role="status"/);
    assert.match(html, /aria-live="polite"/);
    assert.doesNotMatch(html, /Votre session est vérifiée|Se déconnecter|<form|<input/);
    assert.ok(html.includes(`data-access-audience="${audience}"`));
  }
  assert.equal(reads, 0);
});
