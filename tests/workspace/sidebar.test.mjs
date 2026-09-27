import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import {dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../../admin/workspace/sidebar.tsx', import.meta.url))],
  bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external',
  target: 'es2022', logLevel: 'silent',
});
const bundlePath = fileURLToPath(new URL('../../work/sidebar-test-bundle.cjs', import.meta.url));
const compiled = new Module(bundlePath);
compiled.filename = bundlePath;
compiled.paths = Module._nodeModulePaths(dirname(bundlePath));
compiled._compile(bundle.outputFiles[0].text, bundlePath);
const {Sidebar} = compiled.exports;

const render = props => renderToStaticMarkup(createElement(Sidebar, {
  primaryItems: [], account: {displayName: 'Camille Martin'}, onLogout: () => {}, ...props,
}));

test('renders the original Creezio navigation sections only for supplied destinations and slots', () => {
  const html = render({
    primaryItems: [{id: 'home', label: 'Accueil', href: '/workspace/accueil'}],
    adminItems: [{id: 'team', label: 'Équipe', onSelect: () => {}}],
    actionItems: [{id: 'tour', label: 'Visite guidée', onSelect: () => {}}],
    activeItemId: 'team',
    renderPlugins: () => createElement('a', {href: '/workspace/plugin'}, 'Module autorisé'),
    renderTools: () => createElement('button', {type: 'button'}, 'Outil autorisé'),
    renderAccountActions: () => createElement('button', {type: 'button'}, 'Compte autorisé'),
  });
  assert.match(html, /CREEZIO/);
  assert.match(html, /href="\/workspace\/accueil"/);
  assert.match(html, /Module autorisé/);
  assert.match(html, /Admin/);
  assert.match(html, /Outils/);
  assert.match(html, /Équipe/);
  assert.match(html, /Visite guidée/);
  assert.match(html, /Compte autorisé/);
  assert.match(html, /Camille Martin/);
  assert.match(html, /aria-label="Déconnexion"/);
  assert.doesNotMatch(html, /href="\/admin"|Hermes|n8n|Voir comme/);
});

test('hides absent sections and never turns an action into a fabricated link', () => {
  const html = render({primaryItems: [{id: 'native', label: 'Panneau natif', onSelect: () => {}}]});
  assert.match(html, /Panneau natif/);
  assert.doesNotMatch(html, /href=/);
  assert.doesNotMatch(html, /data-creezio-aid="nav.admin"|Outils/);
});

test('renders a collapsed desktop sidebar and a labeled mobile dialog', () => {
  const html = render({collapsed: true, mobileOpen: true,
    primaryItems: [{id: 'home', label: 'Accueil', href: '/workspace/accueil'}]});
  assert.match(html, /aria-label="Déplier la barre latérale"/);
  assert.match(html, /role="dialog" aria-modal="true"/);
  assert.match(html, /Menu de navigation/);
  assert.match(html, /aria-label="Fermer le menu"/);
  assert.match(html, /<span class="sr-only">Accueil<\/span>/);
});
