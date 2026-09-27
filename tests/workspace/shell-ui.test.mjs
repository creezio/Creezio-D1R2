import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {unlinkSync,writeFileSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

async function loadShellModule(name) {
  const source = fileURLToPath(new URL(`../../admin/workspace/${name}.tsx`, import.meta.url));
  const bundle = await build({entryPoints: [source], bundle: true, write: false,
    format: 'esm', platform: 'node', packages: 'external', target: 'es2022', logLevel: 'silent'});
  const bundlePath = fileURLToPath(new URL(`./.shell-render-${name}-${randomUUID()}.mjs`, import.meta.url));
  let written=false;
  try {
    writeFileSync(bundlePath,bundle.outputFiles[0].text,{flag:'wx'});written=true;
    return await import(pathToFileURL(bundlePath).href);
  } finally {if(written)unlinkSync(bundlePath);}
}

const {WorkspaceTabBar} = await loadShellModule('workspace-tab-bar');
const {DestinationSearchDialog, filterDestinations} = await loadShellModule('destination-search');
const {toolbarKey} = await loadShellModule('page-toolbar-context');

test('original shell tabs keep pinned and locked controls while showing an authorized page', () => {
  const html = renderToStaticMarkup(createElement(WorkspaceTabBar, {
    tabs: [
      {id: 'home', title: 'Accueil', locked: true, pinned: true, location: {url: '/workspace', viewId: 'home'}},
      {id: 'notes', title: 'Notes', locked: false, pinned: false, location: {url: '/notes', viewId: 'notes'}},
    ], activeTabId: 'notes', canGoBack: false, canGoForward: true,
    onActivate() {}, onClose() {}, onLock() {}, onMove() {}, onBack() {}, onForward() {},
    onOpenDestinationSearch() {},
    pageChrome: {kind: 'section', href: '/notes', panelId: 'notes'},
  }));
  assert.match(html, /class="[^"]*tf-tab/);
  assert.match(html, /data-tab-locked="true"/);
  assert.match(html, /aria-label="Fermer Notes"/);
  assert.doesNotMatch(html, /aria-label="Fermer Accueil"/);
  assert.match(html, /aria-label="Nouvel onglet"/);
  assert.match(html, /Rechercher une vue/);
});

test('destination palette only renders supplied destinations and filters their titles', () => {
  const items = [{id: 'one', title: 'Équipe', viewId: 'team'},
    {id: 'two', title: 'Notes', viewId: 'notes', description: 'Mes brouillons'}];
  assert.deepEqual(filterDestinations(items, 'mes notes').map(item => item.id), ['two']);
  assert.deepEqual(filterDestinations(items, 'ÉQUIPE').map(item => item.id), ['one']);
  const html = renderToStaticMarkup(createElement(DestinationSearchDialog, {
    open: false, newTabMode: true, items, onOpenChange() {}, onChoose() {},
  }));
  assert.match(html, /open:flex/);
  assert.match(html, /Équipe/);
  assert.match(html, /Notes/);
  assert.doesNotMatch(html, /Fournisseurs|Panier/);
});

test('toolbar registration keys isolate panels and strip query variants', () => {
  assert.equal(toolbarKey('panel-a', '/notes?view=one'), toolbarKey('panel-a', '/notes?view=two'));
  assert.notEqual(toolbarKey('panel-a', '/notes'), toolbarKey('panel-b', '/notes'));
});
