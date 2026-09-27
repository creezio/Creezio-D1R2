import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const require = createRequire(import.meta.url);
const bundle = await build({entryPoints:[fileURLToPath(new URL('../../ui/panel.tsx',import.meta.url))],
  bundle:true,platform:'node',format:'cjs',packages:'external',write:false,logLevel:'silent'});
const module = {exports:{}};
new Function('require','module','exports',bundle.outputFiles[0].text)(require,module,module.exports);
const {ConversationPanel} = module.exports;
const noop = () => {};
const props = {variant:'embedded',open:true,onOpenChange:noop,mode:'chat',onModeChange:noop,
  selectedId:'c1',conversations:[{id:'c1',title:'Test',mode:'chat',updatedAt:new Date().toISOString(),archivedAt:null}],
  messages:[{id:'m1',role:'user',content:'Bonjour'}],draft:'Brouillon conservé',onDraftChange:noop,
  onCreate:noop,onSelect:noop,onArchive:noop,onRestore:noop,searchQuery:'',onSearchQueryChange:noop,
  showArchived:false,onShowArchivedChange:noop,hasMore:false,onLoadMore:noop,providerStatus:'no_provider'};

test('embedded conversation renders history, draft, and an explicit unavailable provider', () => {
  const html = renderToStaticMarkup(React.createElement(ConversationPanel, props));
  assert.match(html,/data-conversations-panel="open"/);
  assert.match(html,/Bonjour/);
  assert.match(html,/value="Brouillon conservé"/);
  assert.match(html,/Fournisseur IA non configuré/);
  assert.match(html,/<button[^>]*disabled=""[^>]*aria-label="Envoyer — fournisseur indisponible"/);
  assert.doesNotMatch(html,/aria-label="Ouvrir l(?:&#x27;|')assistant"/);
});

test('floating admin view starts from the assistant launcher without exposing thread content', () => {
  const html = renderToStaticMarkup(React.createElement(ConversationPanel,{...props,variant:'floating',open:false}));
  assert.match(html,/aria-label="Ouvrir l(?:&#x27;|')assistant"/);
  assert.doesNotMatch(html,/Bonjour|Brouillon conservé/);
});

test('older history is requested above the visible messages', () => {
  const html = renderToStaticMarkup(React.createElement(ConversationPanel,{...props,
    hasMoreMessages:true,onLoadMoreMessages:noop}));
  assert.ok(html.indexOf('Charger les messages précédents') < html.indexOf('Bonjour'));
});

test('uncertain attachment is announced without implying the file was linked', () => {
  const html = renderToStaticMarkup(React.createElement(ConversationPanel,{...props,onAttach:noop,
    attachments:[{fileId:'f1',filename:'document.pdf',byteSize:1024}],onDownloadAttachment:noop,
    attachmentState:{phase:'unknown',message:'Résultat incertain : vérifiez avant de réessayer.'},
    onRetryUpload:noop,
    onReconcileUnknown:noop}));
  assert.match(html,/aria-label="Ajouter une pièce jointe"/);
  assert.match(html,/document.pdf/);
  assert.match(html,/role="alert"[^>]*>Résultat incertain/);
  assert.match(html,/Reprendre le téléversement/);
  assert.match(html,/Vérifier l.opération en attente/);
  assert.doesNotMatch(html,/est joint à la conversation/);
});
