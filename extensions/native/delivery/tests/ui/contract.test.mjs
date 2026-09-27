import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import {dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {deliveryViewModel} from '../../../../../sdk/delivery/view-model.ts';

const bundle = await build({entryPoints: [fileURLToPath(new URL('../../ui/presentation.tsx', import.meta.url))],
  bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external', logLevel: 'silent',
  plugins: [{name: 'local-sdk-ui', setup(ctx) {
    ctx.onResolve({filter: /^@creezio\/sdk\/ui$/}, () => ({
      path: fileURLToPath(new URL('../../../../../sdk/ui/index.ts', import.meta.url))}));
    ctx.onResolve({filter: /^@creezio\/sdk\/ui\/assistant-provider$/}, () => ({
      path: fileURLToPath(new URL('../../../../../sdk/ui/assistant-provider-impl.tsx', import.meta.url))}));
  }}]});
const bundlePath = fileURLToPath(new URL('./delivery-ui-bundle.cjs', import.meta.url));
const compiled = new Module(bundlePath);
compiled.filename = bundlePath;
compiled.paths = Module._nodeModulePaths(dirname(bundlePath));
compiled._compile(bundle.outputFiles[0].text, bundlePath);
const {DeliveryOverview} = compiled.exports;
const actions = {onConfigure() {}, onPrepare() {}, onStart() {}, onRefresh() {}, onReconcile() {}};

test('prepared screen explains local interruption and never displays a credential field', () => {
  const model = deliveryViewModel({profile: 'docker-local', connection: 'connected',
    configuration: 'ready', preparation: 'ready', planReviewed: true, transfer: null});
  const html = renderToStaticMarkup(createElement(DeliveryOverview, {model, ...actions}));
  assert.match(html, /Interruption locale prévue/);
  assert.match(html, /runtime Docker local s’arrête pendant la capture, la compilation/);
  assert.match(html, /Gardez cet onglet ouvert/);
  assert.match(html, /une fois le runtime redémarré/);
  const startButton = html.match(/<button\b[^>]*>Lancer la livraison<\/button>/)?.[0];
  assert.ok(startButton);
  assert.doesNotMatch(startButton, /\sdisabled(?:=|[ >])/);
  assert.doesNotMatch(html, /apiToken|databaseId|<input/);
});

test('uncertain publication exposes reconciliation on the exact transfer', () => {
  const model = deliveryViewModel({profile: 'docker-local', connection: 'connected',
    configuration: 'ready', preparation: 'ready', planReviewed: true,
    transfer: {id: 'transfer-1', phase: 'delivery-unknown'}});
  const html = renderToStaticMarkup(createElement(DeliveryOverview, {model, ...actions}));
  assert.match(html, /transfer-1/);
  assert.match(html, /Vérifier ce transfert/);
  assert.match(html, /À vérifier/);
  assert.doesNotMatch(html, /Lancer la livraison/);
});
