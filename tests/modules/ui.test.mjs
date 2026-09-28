import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const require = createRequire(import.meta.url);
const bundled = await build({
  entryPoints: [fileURLToPath(new URL('../../extensions/native/modules-settings/ui/presentation.tsx', import.meta.url))],
  bundle: true, write: false, platform: 'node', format: 'cjs', target: 'es2022', logLevel: 'silent',
  external: ['react', 'react-dom'],
});
assert.ok(bundled.outputFiles[0]);
const loaded = {exports: {}};
new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(require, loaded, loaded.exports);
const ui = loaded.exports;
const documentationBundle = await build({
  entryPoints: [fileURLToPath(new URL('../../extensions/native/modules-settings/ui/documentation.tsx', import.meta.url))],
  bundle: true, write: false, platform: 'node', format: 'cjs', target: 'es2022', logLevel: 'silent',
  external: ['react', 'react-dom'],
});
const documentationModule = {exports: {}};
new Function('require', 'module', 'exports', documentationBundle.outputFiles[0].text)(
  require, documentationModule, documentationModule.exports);
const documentation = documentationModule.exports;
const persistenceBundle = await build({
  entryPoints: [fileURLToPath(new URL('../../extensions/native/modules-settings/ui/persistence.ts', import.meta.url))],
  bundle: true, write: false, platform: 'node', format: 'cjs', target: 'es2022', logLevel: 'silent',
});
const persistenceModule = {exports: {}};
new Function('require', 'module', 'exports', persistenceBundle.outputFiles[0].text)(
  require, persistenceModule, persistenceModule.exports);
const render = (Component, props) => renderToStaticMarkup(createElement(Component, props));
const catalog = (patch = {}) => ({moduleId: 'atelier.panier', title: 'Panier', description: 'Ventes et commandes',
  origin: '@atelier/panier', version: '2.1.0', candidateKey: 'candidate-1', codePresent: false,
  enabled: false, configuration: 'unknown', operational: 'unknown', visibility: 'available', ...patch});
const installedMetadata = (kind = 'readme') => ({moduleId: 'atelier.panier',
  origin: 'https://atelier.example/panier', version: '2.1.0', sourceRevision: 'release-2.1.0',
  runtimeIntegrity: 'sha256-' + 'a'.repeat(64), kind, visibility: 'public',
  path: kind === 'readme' ? 'README.md' : kind === 'prd' ? 'prd.md' : 'CHANGELOG.md',
  digest: 'sha256-' + 'b'.repeat(64), byteLength: 42, blockCount: 1});

test('installed PRD and changelog render escaped original-style text with version binding', () => {
  const metadata = installedMetadata('prd');
  const content = 'Ligne 1\n<script>alert(1)</script>';
  const html = render(documentation.InstalledDocumentCard, {kind: 'prd', metadata,
    document: {...metadata, content}, loading: false, error: '', onRetry() {}});
  assert.match(html, /Product Requirements Document/);
  assert.match(html, /Version installée/);
  assert.match(html, /release-2\.1\.0/);
  assert.match(html, /whitespace-pre-line/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.equal(documentation.sameInstalledDocument(metadata, {...metadata, digest: 'sha256-' + 'c'.repeat(64), content}), false);
  const stale = render(documentation.InstalledDocumentCard, {kind: 'prd', metadata,
    document: {...metadata, digest: 'sha256-' + 'c'.repeat(64), content: 'Ancienne version privée'},
    loading: false, error: '', onRetry() {}});
  assert.doesNotMatch(stale, /Ancienne version privée/);
  const revoked = render(documentation.InstalledDocumentCard, {kind: 'prd', metadata: null,
    document: {...metadata, content: 'Contenu retenu'}, loading: false, error: '', onRetry() {}});
  assert.doesNotMatch(revoked, /Contenu retenu/);
  const changelog = render(documentation.InstalledDocumentCard, {kind: 'changelog',
    metadata: installedMetadata('changelog'), document: null, loading: false, error: '', onRetry() {}});
  assert.match(changelog, /Changelog/);
  assert.match(changelog, /Sélectionnez Lire/);
});

test('Documents lists installed README, PRD and changelog without editing controls', () => {
  const documents = ['readme', 'prd', 'changelog'].map(installedMetadata);
  const html = render(documentation.InstalledDocumentsPanel, {documents, selected: 'readme',
    loaded: {...documents[0], content: '# Panier\nDocumentation installée'}, loading: false,
    error: '', onSelect() {}, onRetry() {}});
  assert.match(html, /README/);
  assert.match(html, /PRD/);
  assert.match(html, /Changelog/);
  assert.match(html, /# Panier/);
  assert.match(html, /whitespace-pre-line/);
  assert.doesNotMatch(html, /type="file"|Restaurer|Téléverser|Modifier/);
  assert.doesNotMatch(html, /dangerouslySetInnerHTML/);
});

test('workspace module label fits metadata without changing the full business title', () => {
  assert.equal(ui.moduleWorkspaceLabel('  Panier\n\t connecté\u0007  ', 'atelier.panier'), 'Panier connecté');
  assert.equal(ui.moduleWorkspaceLabel('\n\u0007 ', 'atelier.panier'), 'atelier.panier');
  const full = 'A'.repeat(198) + '😀' + 'B';
  const label = ui.moduleWorkspaceLabel(full, 'atelier.panier');
  assert.equal(label, 'A'.repeat(198) + '…');
  assert.ok(label.length <= 200);
  assert.ok(label.isWellFormed());
  assert.equal(ui.moduleWorkspaceLabel('A'.repeat(198) + '😀', 'atelier.panier'), 'A'.repeat(198) + '😀');
  assert.equal(ui.moduleWorkspaceLabel('Titre\uD800', 'atelier.panier'), 'Titre\uFFFD');
  assert.equal(full, 'A'.repeat(198) + '😀' + 'B');
});

test('catalogue preserves Product Hub cards while distinguishing package and runtime states', () => {
  const html = render(ui.CatalogCards, {items: [catalog(), catalog({moduleId: 'atelier.catalogue', title: 'Catalogue',
    codePresent: true, enabled: true, configuration: 'ready', operational: 'ready', visibility: 'current'})], onOpen() {}});
  assert.match(html, /Panier/);
  assert.match(html, /Catalogue/);
  assert.match(html, /@atelier\/panier/);
  assert.match(html, /Disponible au catalogue/);
  assert.match(html, /Absent de la livraison/);
  assert.match(html, /Présent dans la livraison/);
  assert.match(html, /Activé/);
  assert.match(html, /Configuré/);
  assert.match(html, /Opérationnel/);
  assert.equal([...html.matchAll(/Voir la fiche/g)].length, 4);
  const unready = render(ui.ModuleStatus, {item: catalog({codePresent: true, enabled: true,
    configuration: 'missing', operational: 'unavailable'})});
  assert.match(unready, /Configuration manquante/);
  assert.match(unready, /Indisponible/);
});

test('detail shows direct and transitive graph, optional inactivity and server diagnostics', () => {
  const graph = render(ui.DependencyCard, {title: 'Dépend de', description: 'Fournisseurs requis et facultatifs', items: [
    {moduleId: 'atelier.catalogue', required: true, active: true, versionRange: '>=2 <3', via: []},
    {moduleId: 'tiers.stock', required: false, active: false, versionRange: '^1', via: ['atelier.panier', 'atelier.catalogue']},
  ]});
  assert.match(graph, /atelier.catalogue/);
  assert.match(graph, /Obligatoire/);
  assert.match(graph, /Facultative/);
  assert.match(graph, /Inactive/);
  assert.match(graph, /atelier.panier → atelier.catalogue/);
  const diagnostics = render(ui.DiagnosticCard, {items: [{code: 'dependency_conflict', severity: 'error',
    moduleId: 'atelier.panier', message: 'Catalogue 1.8 incompatible'}]});
  assert.match(diagnostics, /Bloquant/);
  assert.match(diagnostics, /Catalogue 1.8 incompatible/);
});

test('plan states publication requirement and refuses an action on blocking diagnostics', () => {
  const preview=props=>render(ui.PlanPreviewCard,{baselineAcknowledged:false,
    onAcknowledgeBaseline(){},...props});
  const plan = {planDigest: 'sha256-' + 'a'.repeat(64), baseRevision: 4,
    baseCompositionDigest: 'sha256-' + 'b'.repeat(64), baseLockDigest: 'sha256-' + 'e'.repeat(64),
    baselineChanged:false,targetCompositionDigest: 'sha256-' + 'c'.repeat(64),
    targetLockDigest: 'sha256-' + 'd'.repeat(64), requiresPublication: true, disabledContributionCount: 0,
    actions: [{kind: 'update', moduleId: 'atelier.panier', fromVersion: '2.0.0', toVersion: '2.1.0', requiresPublication: true}],
    diagnostics: [{code: 'dependency_conflict', severity: 'error', moduleId: 'atelier.panier', message: 'Catalogue incompatible'}]};
  const blocked = preview({plan, onAccept() {}, disabled: false});
  assert.match(blocked, /2.0.0 → 2.1.0/);
  assert.match(blocked, /Publication nécessaire/);
  assert.match(blocked, /construction et publication vérifiées/);
  assert.doesNotMatch(blocked, /contribution\(s\) seront désactivées/);
  assert.match(blocked, /<button[^>]*disabled=""[^>]*>Accepter le plan<\/button>/);
  const ready = preview({plan: {...plan, diagnostics: []}, onAccept() {}, disabled: false});
  assert.doesNotMatch(ready, /<button[^>]*disabled=""[^>]*>Accepter le plan<\/button>/);
  assert.doesNotMatch(ready, /installé avec succès|publication terminée/i);
  const unchanged = preview({plan: {...plan, diagnostics: [], requiresPublication: false},
    onAccept() {}, disabled: false});
  assert.match(unchanged, /Il n’y a rien à accepter/);
  assert.match(unchanged, /<button[^>]*disabled=""[^>]*>Accepter le plan<\/button>/);
  const sideEffects = preview({plan: {...plan, disabledContributionCount: 3}, onAccept() {}, disabled: false});
  assert.match(sideEffects, /3 contribution\(s\) seront désactivées/);
  assert.match(sideEffects, /intégrations facultatives/);
  const added = {...plan.actions[0], kind: 'add', fromVersion: null, audiences: ['admin', 'app']};
  const exposure = preview({plan: {...plan, actions: [added]}, onAccept() {}, disabled: false});
  assert.match(exposure, /Interface prévue : Administrateur et utilisateurs/);
  const headless = preview({plan: {...plan, actions: [{...added, audiences: []}]}, onAccept() {}, disabled: false});
  assert.match(headless, /Interface prévue : Sans interface \(headless\)/);
  const changed=preview({plan:{...plan,diagnostics:[],baselineChanged:true},onAccept(){},disabled:false});
  assert.match(changed,/dernière cible clôturée/);
  assert.match(changed,/<button[^>]*disabled=""[^>]*>Accepter le plan<\/button>/);
  const acknowledged=preview({plan:{...plan,diagnostics:[],baselineChanged:true},
    baselineAcknowledged:true,onAccept(){},disabled:false});
  assert.doesNotMatch(acknowledged,/<button[^>]*disabled=""[^>]*>Accepter le plan<\/button>/);
});

test('journal records acceptance without implying a deployed version and escapes metadata', () => {
  const html = render(ui.JournalCard, {items: [{revision: 8, planId: '<plan-id>', planDigest: 'sha256-x',
    actorPrincipalId: 'principal-1', baseCompositionDigest: 'sha256-b', targetCompositionDigest: 'sha256-c',
    occurredAtMs: 1_700_000_000_000, eventKind: 'plan-accepted'},
  {revision: 9, planId: '<plan-id>', planDigest: 'sha256-x',actorPrincipalId:'principal-1',
    baseCompositionDigest:'sha256-b',targetCompositionDigest:'sha256-c',
    occurredAtMs:1_700_000_000_001,eventKind:'plan-effective'}]});
  assert.match(html, /Plan accepté/);
  assert.match(html, /Publication vérifiée/);
  assert.match(html, /versions effectivement publiées/);
  assert.match(html, /&lt;plan-id&gt;/);
  assert.doesNotMatch(html, /<plan-id>/);
});

test('pending command retains only request identity in the declared panel state', () => {
  let state = {scrollTop: 36, data: {stale: 'discard'}};
  let writable = true;
  const persistence = persistenceModule.exports.modulePendingPersistence({
    readPanelState: () => state,
    savePanelState: next => {if (!writable) return false; state = next; return true;},
  });
  const pending = {requestKey: '885772db-f52c-46fb-a913-a70503c1bdf3', owner: '["principal","session"]',
    operation:'plans.cancel-pending'};
  assert.equal(persistence.save(pending), true);
  assert.deepEqual(state, {scrollTop: 36, data: {pendingRequestKey: pending.requestKey,
    pendingOwner: pending.owner,pendingOperation:pending.operation}});
  assert.deepEqual(persistence.read(), pending);
  writable = false;
  assert.equal(persistence.save(null), false);
  assert.deepEqual(persistence.read(), pending);
  writable = true;
  assert.equal(persistence.save(null), true);
  assert.deepEqual(state.data, {});
});
