import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const require = createRequire(import.meta.url);
const bundle = await build({entryPoints:[fileURLToPath(new URL('../../ui/index.tsx', import.meta.url))],
  bundle:true,write:false,platform:'node',format:'cjs',target:'es2022',logLevel:'silent',
  external:['react','react-dom','lucide-react'],plugins:[{name:'css-module-stub',setup(builder){
    builder.onLoad({filter:/\.module\.css$/},()=>({contents:'export default new Proxy({}, {get: (_, key) => String(key)});',loader:'js'}));
  }}]});
const mod = {exports:{}};
new Function('require','module','exports',bundle.outputFiles[0].text)(require,mod,mod.exports);

test('standard theme renders only host navigation, content and the four supported slots', () => {
  const seen=[];
  const html=renderToStaticMarkup(createElement(mod.exports.StandardFrontTheme,{
    brand:{name:'Application Atelier',description:'Espace de travail'},account:{displayName:'Alice'},
    navigation:[{id:'one',title:'Commandes',viewId:'atelier:orders',order:1,active:true},
      {id:'two',title:'Stocks',viewId:'atelier:stock',order:2,active:false}],location:null,
    children:createElement('article',null,'Vue autorisée'),
    renderSlot(slot){seen.push(slot);return slot==='front.header'?'En-tête métier':null;},
    navigate(){return true;},onLogin(){},onLogout(){},onRefresh(){}
  }));
  assert.deepEqual(seen,['front.header','front.sidebar','front.context','front.footer']);
  assert.match(html,/Application Atelier/);assert.match(html,/Commandes/);
  assert.match(html,/Stocks/);assert.match(html,/Vue autorisée/);
  assert.match(html,/En-tête métier/);assert.match(html,/aria-current="page"/);
  assert.doesNotMatch(html,/Certi|Mon van|Nouvelle discussion|textarea/);
  const css=readFileSync(new URL('../../ui/theme.module.css',import.meta.url),'utf8');
  assert.match(css,/#faf7f1/);assert.match(css,/#14182f/);
});
