import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import {dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {deliveryViewModel} from '@creezio/sdk/delivery/view-model';
import {deliveryUpdateViewModel} from '@creezio/sdk/delivery/update-view-model';

const bundle = await build({entryPoints: [fileURLToPath(new URL('../../ui/presentation.tsx', import.meta.url))],
  bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external', logLevel: 'silent',
  plugins: [{name: 'local-sdk-ui', setup(ctx) {
    ctx.onResolve({filter: /^@creezio\/sdk\/ui$/}, () => ({
      path: fileURLToPath(import.meta.resolve('@creezio/sdk/ui'))}));
    ctx.onResolve({filter: /^@creezio\/sdk\/ui\/assistant-provider$/}, () => ({
      path: fileURLToPath(import.meta.resolve('@creezio/sdk/ui/assistant-provider'))}));
  }}]});
const bundlePath = fileURLToPath(new URL('./delivery-ui-bundle.cjs', import.meta.url));
const compiled = new Module(bundlePath);
compiled.filename = bundlePath;
compiled.paths = Module._nodeModulePaths(dirname(bundlePath));
compiled._compile(bundle.outputFiles[0].text, bundlePath);
const {DeliveryOverview,DeliveryUpdateOverview} = compiled.exports;
const actions = {onConfigure() {}, onPrepare() {}, onStart() {}, onRefresh() {},
  onReconcile() {}, onRetry() {}, onReject() {}};

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
  const base={authorized:true,rejectAvailable:true,identityVersion:0,busy:false,connection:'connected',
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
      phase:'delivery-unknown',summary:null,finalUrl:null,registryStatus:'unknown',retryEligible:true}};
  html=renderToStaticMarkup(createElement(DeliveryUpdateOverview,
    {model:deliveryUpdateViewModel(uncertain),...actions}));
  assert.match(html,/Vérifier cette mise à jour/);
  assert.match(html,/Nouvelle tentative explicite/);
  assert.match(html,/À vérifier/);
  assert.match(html,/<button\b[^>]*\sdisabled=""[^>]*>Lancer la mise à jour<\/button>/);
  const routed={...uncertain,update:{...uncertain.update,retryEligible:false}};
  html=renderToStaticMarkup(createElement(DeliveryUpdateOverview,
    {model:deliveryUpdateViewModel(routed),...actions}));
  assert.doesNotMatch(html,/Nouvelle tentative explicite/);
  assert.match(html,/Vérifier cette mise à jour/);
});

test('Cloudflare 10021 offers a checked refusal then a fresh plan while preserving D1',()=>{
  const base={authorized:true,rejectAvailable:true,identityVersion:0,busy:false,connection:'connected',
    inspection:{kind:'update',readiness:'ready',currentPublicationId:'baseline-1',
      activeUpdateId:'update-1',target:{accountId:'account-1',workerName:'worker-1'}},
    prepared:null,saved:{kind:'update',owner:'admin-1',updateId:'update-1',
      planDigest:`sha256-${'a'.repeat(64)}`,started:true},error:null};
  const diagnostic={phase:'wrangler',reason:'exit_nonzero',exitCode:1,apiCodes:[10021],
    validationIssue:'unknown_validation'};
  const uncertain={...base,update:{kind:'update',updateId:'update-1',planDigest:base.saved.planDigest,
    phase:'delivery-unknown',summary:null,finalUrl:null,registryStatus:'unknown',
    retryEligible:false,diagnostic}};
  let html=renderToStaticMarkup(createElement(DeliveryUpdateOverview,
    {model:deliveryUpdateViewModel(uncertain),...actions}));
  assert.match(html,/Vérifier le refus signalé/);
  assert.match(html,/Cloudflare a signalé un refus de validation/);
  assert.doesNotMatch(html,/Nouvelle tentative explicite/);
  assert.doesNotMatch(html,/Mise à jour confirmée/);
  html=renderToStaticMarkup(createElement(DeliveryUpdateOverview,
    {model:deliveryUpdateViewModel({...uncertain,rejectAvailable:false}),...actions}));
  assert.doesNotMatch(html,/Vérifier le refus signalé/);
  const rejected={...uncertain,inspection:{...base.inspection,activeUpdateId:null},
    update:{...uncertain.update,phase:'rejected',registryStatus:'pending'}};
  html=renderToStaticMarkup(createElement(DeliveryUpdateOverview,
    {model:deliveryUpdateViewModel(rejected),...actions}));
  assert.match(html,/Publication refusée et vérifiée/);
  assert.match(html,/L’ancienne reste publiée/);
  assert.match(html,/schéma D1 déjà appliqué et les données sont conservés/);
  assert.doesNotMatch(html,/Vérifier le refus signalé/);
  assert.doesNotMatch(html.match(/<button\b[^>]*>Préparer la mise à jour<\/button>/)?.[0]??'',
    /\sdisabled(?:=|[ >])/);
});
