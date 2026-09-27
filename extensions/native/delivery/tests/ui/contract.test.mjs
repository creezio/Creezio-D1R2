import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import {dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {deliveryViewModel} from '../../../../../sdk/delivery/view-model.ts';
import {deliveryUpdateViewModel} from '../../../../../sdk/delivery/update-view-model.ts';

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
const {DeliveryOverview,DeliveryUpdateOverview} = compiled.exports;
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

test('update screen requires an explicit reviewed plan and offers exact reconciliation', () => {
  const base={authorized:true,identityVersion:0,busy:false,connection:'connected',
    inspection:{kind:'update',readiness:'ready',currentPublicationId:'publication-1',
      activeUpdateId:null,target:{accountId:'account-1',workerName:'worker-1'}},
    prepared:null,update:null,saved:null,error:null};
  let html=renderToStaticMarkup(createElement(DeliveryUpdateOverview,
    {model:deliveryUpdateViewModel(base),...actions}));
  assert.match(html,/Plan explicite/);
  assert.match(html,/conserve les données D1\/R2 et les secrets/);
  assert.match(html,/<button\b[^>]*disabled[^>]*>Lancer la mise à jour<\/button>/);
  const reviewed={...base,prepared:{kind:'update',updateId:'update-1',planDigest:`sha256-${'a'.repeat(64)}`,
    summary:{title:'Plan',details:[],warnings:[]}},saved:{kind:'update',owner:'admin-1',
      updateId:'update-1',planDigest:`sha256-${'a'.repeat(64)}`,started:false}};
  html=renderToStaticMarkup(createElement(DeliveryUpdateOverview,
    {model:deliveryUpdateViewModel(reviewed),...actions}));
  assert.doesNotMatch(html.match(/<button\b[^>]*>Lancer la mise à jour<\/button>/)?.[0]??'',
    /\sdisabled(?:=|[ >])/);
  const uncertain={...reviewed,saved:{...reviewed.saved,started:true},
    update:{kind:'update',updateId:'update-1',planDigest:reviewed.saved.planDigest,
      phase:'delivery-unknown',summary:null,finalUrl:null,registryStatus:'unknown'}};
  html=renderToStaticMarkup(createElement(DeliveryUpdateOverview,
    {model:deliveryUpdateViewModel(uncertain),...actions}));
  assert.match(html,/Vérifier cette mise à jour/);
  assert.match(html,/À vérifier/);
  assert.match(html,/<button\b[^>]*\sdisabled=""[^>]*>Lancer la mise à jour<\/button>/);
});
