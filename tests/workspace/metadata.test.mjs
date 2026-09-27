import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import {dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../../sdk/workspace/metadata.tsx', import.meta.url))],
  bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external',
  target: 'es2022', logLevel: 'silent',
});
const bundlePath = fileURLToPath(new URL('../../work/metadata-test-bundle.cjs', import.meta.url));
const compiled = new Module(bundlePath);
compiled.filename = bundlePath;
compiled.paths = Module._nodeModulePaths(dirname(bundlePath));
compiled._compile(bundle.outputFiles[0].text, bundlePath);
const {createWorkspaceMetadataStore, WorkspaceMetadataProvider, useWorkspaceMetadata,
  useWorkspaceMetadataForPanels} = compiled.exports;

test('metadata is scoped to panel and owner, updates only on change, and cleans up', () => {
  const store = createWorkspaceMetadataStore(), first = Symbol('first'), second = Symbol('second');
  let alphaEvents = 0, betaEvents = 0;
  const stopAlpha = store.subscribe('pane-1', () => {alphaEvents++;});
  store.subscribe('pane-2', () => {betaEvents++;});
  const detail = {title: 'Fiche Alpha', subtitle: 'Révision 2', kind: 'entity',
    trail: [{label: 'Fiches', href: '/records'}, {label: 'Alpha'}]};
  store.register('pane-1', first, detail);
  assert.deepEqual(store.read('pane-1'), detail);
  assert.equal(Object.isFrozen(store.read('pane-1').trail), true);
  assert.equal(alphaEvents, 1); assert.equal(betaEvents, 0);
  store.register('pane-1', first, {...detail, trail: [...detail.trail]});
  assert.equal(alphaEvents, 1, 'equal metadata does not cause a render loop');
  store.register('pane-1', second, {title: 'Plus récent'});
  assert.equal(store.read('pane-1').title, 'Plus récent');
  store.unregister('pane-1', second);
  assert.equal(store.read('pane-1').title, 'Fiche Alpha');
  store.unregister('pane-1', first);
  assert.equal(store.read('pane-1'), null);
  assert.equal(alphaEvents, 4); assert.equal(betaEvents, 0);
  stopAlpha();
  store.register('pane-1', first, {title: 'Monté de nouveau'});
  assert.equal(alphaEvents, 4);
});

test('metadata bounds text and trail and accepts only canonical internal hrefs', () => {
  const store = createWorkspaceMetadataStore(), owner = Symbol('owner');
  const rejected = [
    {title: 'x'.repeat(201)}, {subtitle: 'x'.repeat(201)},
    {kind: 'other'}, {trail: Array.from({length: 13}, () => ({label: 'X'}))},
    {trail: [{label: 'x'.repeat(201)}]},
    {trail: [{label: 'Outside', href: 'https://outside.example'}]},
    {trail: [{label: 'Protocol relative', href: '//outside.example'}]},
    {trail: [{label: 'Traversal', href: '/a/../b'}]},
    {trail: [{label: 'Fragment', href: '/records#secret'}]},
    {trail: [{label: 'Slash', href: '/records\\other'}]},
  ];
  for (const item of rejected) {
    store.register('pane-1', owner, item);
    assert.equal(store.read('pane-1'), null, JSON.stringify(item));
  }
  store.register('pane-1', owner, {title: 'x'.repeat(200), subtitle: 'Sous-titre',
    kind: 'entity', trail: [{label: 'Fiche', href: '/records/alpha?section=notes'}]});
  assert.equal(store.read('pane-1').title.length, 200);
  assert.equal(store.read('pane-1').trail[0].href, '/records/alpha?section=notes');
  store.register('pane-1', owner, {title: 'x'.repeat(201)});
  assert.equal(store.read('pane-1'), null, 'invalid update removes stale metadata');
});

test('metadata hook is inert outside its provider during server rendering', () => {
  function Probe() {
    const metadata = useWorkspaceMetadata('pane-1');
    const all = useWorkspaceMetadataForPanels(['pane-1', 'pane-2']);
    return createElement('span', null, `${metadata?.title ?? 'fallback'}:${all.size}`);
  }
  assert.match(renderToStaticMarkup(createElement(Probe)), /fallback:0/);
  assert.match(renderToStaticMarkup(createElement(WorkspaceMetadataProvider, null,
    createElement(Probe))), /fallback:0/);
});
