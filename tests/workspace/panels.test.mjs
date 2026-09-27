import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const require=createRequire(import.meta.url);
const bundle=await build({entryPoints:[fileURLToPath(new URL('../../sdk/workspace/components.tsx',import.meta.url))],
  bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',logLevel:'silent',
  plugins:[{name:'installed-react',setup(builder){builder.onResolve({filter:/^react(?:-dom)?(?:\/|$)/},
    args=>({path:pathToFileURL(require.resolve(args.path)).href,external:true}));}}]});
const {Workspace,RetainedSubViews}=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

test('retained subviews expose inactive semantics and keep the active view visible',()=>{
  const html=renderToStaticMarkup(createElement(RetainedSubViews,{active:'details',views:[
    {id:'overview',content:createElement('input',{defaultValue:'draft-one'})},
    {id:'details',content:createElement('input',{defaultValue:'draft-two'})}]}));
  assert.match(html,/data-subview="details"/);
  assert.match(html,/draft-two/);
  assert.doesNotMatch(html,/draft-one/);
});

test('workspace renders a safe pending state before a matching projection',()=>{
  const access={audience:'admin',origin:'https://creezio.example',
    getSnapshot:()=>({phase:'loading',session:null,pending:null}),subscribe:()=>()=>{}};
  const html=renderToStaticMarkup(createElement(Workspace,{access,projection:null,views:[],
    navigation:[],client:{},contextId:'application'}));
  assert.match(html,/Vérification de l’accès au workspace/);
  assert.doesNotMatch(html,/role="tabpanel"/);
});
