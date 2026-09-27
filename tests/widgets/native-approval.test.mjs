import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {validWidgetApprovalLink,widgetApprovalPath} from '../../sdk/widgets/approval-link.ts';

const require=createRequire(import.meta.url);
const bundle=await build({entryPoints:[fileURLToPath(new URL('../../sdk/widgets/native-approval.tsx',import.meta.url))],
  bundle:true,platform:'node',format:'cjs',packages:'external',write:false,logLevel:'silent'});
const module={exports:{}};
new Function('require','module','exports',bundle.outputFiles[0].text)(require,module,module.exports);
const {NativeWidgetApprovalCard}=module.exports;
const noop=()=>{};
const preview={approvalId:'approval_1',state:'pending',expiresAtMs:2000,
  operation:{moduleId:'example.widgets-witness',operationId:'rename_record',title:'Renommer la fiche'},
  fields:{Fiche:'alpha',NouveauTitre:'Mise à jour'},inputDigest:`sha256:${'a'.repeat(64)}`,
  csrfNonce:'private-nonce',sessionId:'session_1',principalId:'person_1',contextId:'application'};

test('approval URL selects only a native lookup scope',()=>{
  assert.equal(validWidgetApprovalLink('app','approval_1','application',{admin:true,app:true}),true);
  assert.equal(validWidgetApprovalLink('admin','approval_1','application',{admin:false,app:true}),false);
  assert.equal(validWidgetApprovalLink('app','approval_1',['application'],{admin:true,app:true}),false);
  assert.equal(validWidgetApprovalLink('app','../approval_1','application',{admin:true,app:true}),false);
  assert.equal(widgetApprovalPath('app','approval_1','application'),
    '/approvals/app/approval_1?context=application');
  assert.throws(()=>widgetApprovalPath('app','../approval_1','application'));
});

test('native preview shows trusted fields and decisions only while pending',()=>{
  const pending=renderToStaticMarkup(React.createElement(NativeWidgetApprovalCard,
    {preview,nowMs:1000,busy:false,onDecide:noop,onReload:noop}));
  assert.match(pending,/Renommer la fiche/);
  assert.match(pending,/Mise à jour/);
  assert.match(pending,/Approuver/);
  assert.match(pending,/Refuser/);
  assert.match(pending,/Revenez au client/);
  assert.doesNotMatch(pending,/private-nonce|sha256:/);
  for(const state of ['approved','rejected','consumed','expired']){
    const html=renderToStaticMarkup(React.createElement(NativeWidgetApprovalCard,
      {preview:{...preview,state,csrfNonce:null},nowMs:1000,busy:false,onDecide:noop,onReload:noop}));
    assert.doesNotMatch(html,/>Approuver<|>Refuser</);
    assert.match(html,/Actualiser l’état/);
  }
  const expired=renderToStaticMarkup(React.createElement(NativeWidgetApprovalCard,
    {preview,nowMs:2000,busy:false,onDecide:noop,onReload:noop}));
  assert.doesNotMatch(expired,/>Approuver<|>Refuser</);
});
