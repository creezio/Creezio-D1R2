import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const manifest=JSON.parse(readFileSync(new URL('../../module/manifest.json',import.meta.url)));
const require=createRequire(import.meta.url);
const bundle=await build({entryPoints:[fileURLToPath(new URL('../../ui/workspace/view.tsx',import.meta.url))],
  bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',logLevel:'silent',
  plugins:[{name:'installed-react',setup(builder){builder.onResolve({filter:/^react(?:-dom)?(?:\/|$)/},
    args=>({path:pathToFileURL(require.resolve(args.path)).href,external:true}));}}]});
const {witness_home,witness_record,reconcileEditor,pendingStatusTarget,statusStillCurrent,
  acceptsRecordRevision,sectionUrl}=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

test('declared workspace views render real independent record controls',()=>{
  assert.deepEqual(manifest.contracts.ui.views.map(view=>[view.id,view.route,view.panel.identityFields]),
    [['home','/witness',[]],['record','/witness/{id}',['id']]]);
  const navigation={open:()=>true,readPanelState:()=>null,savePanelState:()=>true};
  const home=renderToStaticMarkup(createElement(witness_home,{panelId:'pane-home',navigation}));
  assert.match(home,/Fiche Alpha/);assert.match(home,/Fiche Bêta/);
  const detail=renderToStaticMarkup(createElement(witness_record,{panelId:'pane-alpha',
    location:{url:'/witness/alpha',viewId:'example.workspace-witness:record'},input:{id:'alpha'},contextId:'application',
    active:true,navigation,client:{}}));
  assert.match(detail,/data-witness-record="alpha"/);
  assert.match(detail,/Enregistrer/);assert.match(detail,/role="tab" aria-selected="false">Notes/);
  assert.doesNotMatch(detail,/Note locale/,'inactive subview is lazy until first visit');
  assert.doesNotMatch(detail,/Fiche Bêta/);
});

test('record declares a bounded persisted draft and restores only its own panel state',()=>{
  const recordView=manifest.contracts.ui.views.find(view=>view.id==='record');
  assert.deepEqual(recordView.panel.stateSchema,{schemaId:'panel-state'});
  const stateSchema=manifest.contracts.schemas.find(schema=>schema.id==='panel-state').schema;
  assert.deepEqual(stateSchema.required,['draftTitle','baseTitle','baseRevision']);
  assert.equal(stateSchema.additionalProperties,false);
  assert.equal(stateSchema.properties.pendingRequestKey.maxLength,128);
  const states=new Map([['alpha',{activeSubview:'notes',data:{draftTitle:'Brouillon Alpha',
    baseTitle:'Alpha',baseRevision:4}}],['beta',{activeSubview:'details',data:{draftTitle:'Brouillon Bêta',
    baseTitle:'Bêta',baseRevision:7}}]]);
  const render=id=>renderToStaticMarkup(createElement(witness_record,{panelId:`pane-${id}`,
    location:{url:`/witness/${id}`,viewId:'example.workspace-witness:record'},input:{id},contextId:'application',
    active:true,navigation:{open:()=>true,readPanelState:()=>states.get(id),savePanelState:()=>true},client:{}}));
  const alpha=render('alpha'),beta=render('beta');
  assert.match(alpha,/role="tab" aria-selected="true">Notes/);
  assert.match(alpha,/data-witness-record="alpha"/);
  assert.doesNotMatch(alpha,/Brouillon Bêta/);
  assert.match(beta,/value="Brouillon Bêta"/);
  assert.doesNotMatch(beta,/Brouillon Alpha/);
});

test('rereading preserves a dirty draft and reports a changed business revision',()=>{
  const dirty={draftTitle:'Mon brouillon',baseTitle:'Ancien titre',baseRevision:4,section:'notes',
    pendingRequestKey:null,pendingExecutionId:null};
  const server={id:'alpha',title:'Titre externe',revision:5};
  assert.deepEqual(reconcileEditor(dirty,server),{editor:dirty,conflict:true});
  const clean={...dirty,draftTitle:'Ancien titre'};
  assert.deepEqual(reconcileEditor(clean,server),{editor:{...clean,draftTitle:'Titre externe',
    baseTitle:'Titre externe',baseRevision:5},conflict:false});
  assert.deepEqual(reconcileEditor(dirty,{...server,title:'Ancien titre',revision:4}),
    {editor:dirty,conflict:false});
});

test('uncertain save remains checkable by its original key without mutation replay',()=>{
  const pending={draftTitle:'Brouillon',baseTitle:'Ancien',baseRevision:4,section:'details',
    pendingRequestKey:'sent-request-key',pendingExecutionId:null};
  assert.deepEqual(pendingStatusTarget(pending),{requestKey:'sent-request-key'});
  assert.deepEqual(pendingStatusTarget({...pending,pendingExecutionId:'execution-1'}),
    {executionId:'execution-1'});
  assert.equal(pendingStatusTarget({...pending,pendingRequestKey:null}),null);
  const html=renderToStaticMarkup(createElement(witness_record,{panelId:'pane-alpha',
    location:{url:'/witness/alpha',viewId:'example.workspace-witness:record'},input:{id:'alpha'},contextId:'application',
    active:true,navigation:{open:()=>true,readPanelState:()=>({data:pending}),savePanelState:()=>true},client:{}}));
  assert.match(html,/Vérifier l’exécution/);
  assert.match(html,/Enregistrer/);
});

test('late responses for save A cannot clear pending save B or regress a confirmed revision',()=>{
  const pendingB={draftTitle:'Titre B',baseTitle:'Titre A',baseRevision:5,section:'details',
    pendingRequestKey:'request-B',pendingExecutionId:null};
  assert.equal(statusStillCurrent(pendingB,'request-A'),false);
  assert.equal(statusStillCurrent(pendingB,'request-B'),true);
  assert.equal(statusStillCurrent({...pendingB,pendingRequestKey:null},'request-B'),false);
  assert.equal(acceptsRecordRevision(5,4),false);
  assert.equal(acceptsRecordRevision(5,5),true);
  assert.equal(acceptsRecordRevision(null,4),true);
});

test('query-only toolbar navigation keeps the same record URL and other parameters',()=>{
  assert.equal(sectionUrl('/witness/alpha?view=compact','notes'),'/witness/alpha?view=compact&section=notes');
  assert.equal(sectionUrl('/witness/beta?section=notes','details'),'/witness/beta?section=details');
});
