import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const require=createRequire(import.meta.url);
const bundle=await build({entryPoints:[fileURLToPath(new URL('../../ui/index.tsx',import.meta.url))],
  bundle:true,write:false,platform:'node',format:'cjs',target:'es2022',logLevel:'silent',
  external:['react','react-dom','lucide-react'],plugins:[{name:'css-module-stub',setup(builder){
    builder.onLoad({filter:/\.module\.css$/},()=>({contents:'export default new Proxy({}, {get: (_, key) => String(key)});',loader:'js'}));
  }}]});
const mod={exports:{}};
new Function('require','module','exports',bundle.outputFiles[0].text)(require,mod,mod.exports);

test('V5 presentation uses projected links and slots without Certivan chat or business content',()=>{
  const seen=[];
  const html=renderToStaticMarkup(createElement(mod.exports.ChatGptLikeFrontTheme,{
    brand:{name:'Application Atelier'},account:null,
    navigation:[{id:'one',title:'Commandes',viewId:'atelier:orders',order:1,active:true},
      {id:'two',title:'Stocks',viewId:'atelier:stock',order:2,active:false}],location:null,
    children:createElement('article',null,'Vue autorisée'),
    renderSlot(slot){seen.push(slot);return slot==='front.context'?'Contexte métier':null;},
    navigate(){return true;},onLogin(){},onLogout(){},onRefresh(){}
  }));
  assert.deepEqual(seen,['front.header','front.sidebar','front.context','front.footer']);
  assert.match(html,/Application Atelier/);assert.match(html,/Commandes/);
  assert.match(html,/Stocks/);assert.match(html,/Vue autorisée/);
  assert.match(html,/Contexte métier/);assert.match(html,/aria-current="page"/);
  assert.match(html,/aria-controls="front-chatgpt-navigation"/);
  assert.doesNotMatch(html,/Certi|Mon van|Nouvelle discussion|textarea/);
  const css=readFileSync(new URL('../../ui/theme.module.css',import.meta.url),'utf8');
  assert.match(css,/#1554d1/);assert.match(css,/@media\(max-width:767px\)/);
});

test('opening the mobile navigation focuses its close control and closing restores the trigger',()=>{
  let effects=[], mobileOpen=true, stateIndex=0, refIndex=0;
  const focusOptions=[];
  const visible=()=>[{}];
  const refs=[{current:{focus(options){focusOptions.push(['trigger',options]);},getClientRects:visible}},
    {current:{focus(options){focusOptions.push(['close',options]);},getClientRects:visible}},
    {current:{focus(options){focusOptions.push(['main',options]);}}}, {current:null}];
  const hooks={
    useState(initial){const index=stateIndex++;return [index===1 ? mobileOpen : initial,
      value=>{if(index===1)mobileOpen=value;}];},
    useRef(){return refs[refIndex++];},
    useEffect(effect){effects.push(effect);},
  };
  const mock={exports:{}};
  new Function('require','module','exports',bundle.outputFiles[0].text)(
    name=>name==='react'?hooks:require(name),mock,mock.exports);
  const props={brand:{name:'Atelier'},account:null,
    navigation:[{id:'one',title:'Commandes',viewId:'atelier:orders',order:1,active:false}],
    children:null,renderSlot(){return null;},navigate(){return true;},
    onLogin(){},onLogout(){},onRefresh(){}};
  const render=()=>{effects=[];stateIndex=0;refIndex=0;return mock.exports.ChatGptLikeFrontTheme(props);};
  let tree=render();
  const originalDocument=globalThis.document;
  const originalWindow=globalThis.window;
  let viewportListener;
  const viewport={matches:true,addEventListener(_event,listener){viewportListener=listener;},removeEventListener(){}};
  globalThis.document={activeElement:null,addEventListener(){},removeEventListener(){}};
  globalThis.window={matchMedia:()=>viewport,requestAnimationFrame(callback){callback();return 1;},cancelAnimationFrame(){}};
  const find=(node,predicate)=>{
    if(Array.isArray(node))return node.map(child=>find(child,predicate)).find(Boolean);
    if(!node||typeof node!=='object')return null;
    if(predicate(node))return node;
    return find(node.props?.children,predicate);
  };
  try {
    for(const effect of effects)effect();
    assert.deepEqual(focusOptions,[['close',{preventScroll:true}]],'keyboard focus enters the opened navigation');
    const workspace=find(tree,node=>node.props?.className==='workspace');
    const sidebar=find(tree,node=>node.props?.id==='front-chatgpt-navigation');
    assert.equal(workspace.props.inert,true);
    assert.equal(sidebar.props['aria-modal'],true);
    const first={getClientRects:visible,focus(options){focusOptions.push(['first',options]);}};
    const last={getClientRects:visible,focus(options){focusOptions.push(['last',options]);}};
    let prevented=0;
    globalThis.document.activeElement=last;
    sidebar.props.onKeyDown({key:'Tab',shiftKey:false,currentTarget:{querySelectorAll:()=>[first,last]},
      preventDefault(){prevented++;}});
    globalThis.document.activeElement=first;
    sidebar.props.onKeyDown({key:'Tab',shiftKey:true,currentTarget:{querySelectorAll:()=>[first,last]},
      preventDefault(){prevented++;}});
    assert.equal(prevented,2,'Tab remains inside the mobile navigation in both directions');
    assert.deepEqual(focusOptions.slice(-2),[['first',{preventScroll:true}],['last',{preventScroll:true}]]);
    const close=find(tree,node=>node.props?.className==='closeMobile');
    close.props.onClick();
    tree=render();for(const effect of effects)effect();
    assert.equal(mobileOpen,false);
    assert.equal(find(tree,node=>node.props?.className==='workspace').props.inert,false);
    assert.deepEqual(focusOptions.at(-1),['trigger',{preventScroll:true}],
      'closing restores focus after the workspace is no longer inert');
    mobileOpen=true;tree=render();for(const effect of effects)effect();
    find(tree,node=>node.props?.className==='navItem').props.onClick();
    tree=render();for(const effect of effects)effect();
    assert.deepEqual(focusOptions.at(-1),['main',{preventScroll:true}],
      'choosing a view moves focus to visible content without scrolling');
    mobileOpen=true;tree=render();for(const effect of effects)effect();
    viewport.matches=false;refs[0].current.getClientRects=()=>[];viewportListener();
    tree=render();for(const effect of effects)effect();
    assert.deepEqual(focusOptions.at(-1),['main',{preventScroll:true}],
      'desktop transition focuses visible content without using the hidden trigger');
  } finally {globalThis.document=originalDocument;globalThis.window=originalWindow;}
  const css=readFileSync(new URL('../../ui/theme.module.css',import.meta.url),'utf8');
  assert.match(css,/visibility:hidden/, 'closed mobile controls are removed from keyboard navigation');
  assert.match(css,/\.sidebar\.mobileOpen\{[^}]*visibility:visible;[^}]*visibility 0s/,
    'opening makes the close control visible before focus moves into the panel');
});
