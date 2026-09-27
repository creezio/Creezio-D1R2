import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {unlinkSync,writeFileSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const bundle=await build({entryPoints:[fileURLToPath(new URL('../../ui/config-panel.tsx',import.meta.url))],
  bundle:true,platform:'node',format:'esm',packages:'external',write:false,logLevel:'silent'});
const rendered=fileURLToPath(new URL(`./.contract-render-${randomUUID()}.mjs`,import.meta.url));
let OpenAIConfigPanel,written=false;
try{
  writeFileSync(rendered,bundle.outputFiles[0].text,{flag:'wx'});written=true;
  ({OpenAIConfigPanel}=await import(pathToFileURL(rendered).href));
}finally{if(written)unlinkSync(rendered);}
const noop=async()=>({kind:'ok'});

test('admin configuration offers an editable model identifier and never echoes a stored key',()=>{
  const html=renderToStaticMarkup(React.createElement(OpenAIConfigPanel,{
    config:{providerId:'openai.responses.v1',enabled:true,modelId:'allowed-1',state:'ready',revision:2},
    busy:false,error:null,onRefresh:()=>{},onSave:noop,onSaveKey:noop}));
  assert.match(html,/Configuration active/);
  assert.match(html,/Identifiant du modèle/);
  assert.match(html,/<input[^>]*placeholder="Identifiant exact du modèle"/);
  assert.doesNotMatch(html,/<select/);
  assert.match(html,/aria-label="Nouvelle clé API OpenAI"/);
  assert.doesNotMatch(html,/value="sk-/);
});

test('missing configuration does not promise remote model validation',()=>{
  const html=renderToStaticMarkup(React.createElement(OpenAIConfigPanel,{
    config:{providerId:'openai.responses.v1',enabled:false,modelId:null,state:'missing',revision:0},
    busy:false,error:null,onRefresh:()=>{},onSave:noop,onSaveKey:noop}));
  assert.match(html,/Identifiant exact du modèle/);
  assert.doesNotMatch(html,/sera vérifié par le serveur|vérification du modèle en attente/);
  assert.doesNotMatch(html,/<select/);
});
