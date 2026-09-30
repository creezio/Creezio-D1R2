import test from 'node:test';
import assert from 'node:assert/strict';
import {manifest,read} from '../helpers.mjs';
import {createSelectionFence} from '../../ui/selection.ts';

test('Notes and Connect retain separate rights and original list/detail/sync surfaces',()=>{
  assert.deepEqual(manifest.contracts.ui.views.map(row=>row.id),['notes','connect']);
  const source=read('ui/index.tsx');
  for(const element of ['GranolaNotesView','GranolaConnectView','Rechercher une note','Dossier',
    'Résumé','Transcription','Synchronisation','Clé API Granola'])assert.ok(source.includes(element),element);
  assert.match(source,/createCommandJournal/u);
  assert.match(source,/savePanelState/u);
  assert.doesNotMatch(source,/fetch\(|localStorage|sessionStorage/u);
  assert.equal(manifest.contracts.ui.views[0].permissions[0].id,'read');
  assert.equal(manifest.contracts.ui.views[1].permissions[0].id,'manage');
  assert.match(source,/selection\.current\.matches\(serial,/u);
});

test('late detail and transcript pages cannot overwrite a newer note selection',async()=>{
  const fence=createSelectionFence(),visible=[];
  let finishA,finishB;
  const pendingA=new Promise(resolve=>{finishA=resolve;});
  const pendingB=new Promise(resolve=>{finishB=resolve;});
  const a=fence.open('not_A'),first=pendingA.then(value=>{
    if(fence.matches(a,'not_A'))visible.push(value);
  });
  const b=fence.open('not_B'),second=pendingB.then(value=>{
    if(fence.matches(b,'not_B'))visible.push(value);
  });
  finishB('B detail');finishA('A detail');
  await Promise.all([first,second]);
  assert.deepEqual(visible,['B detail']);
  const pageA=fence.open('not_B');
  const pageB=fence.open('not_B');
  if(fence.matches(pageA,'not_B'))visible.push('old transcript page');
  if(fence.matches(pageB,'not_B'))visible.push('new transcript page');
  fence.reset();
  assert.equal(fence.matches(pageB,'not_B'),false);
  assert.deepEqual(visible,['B detail','new transcript page']);
});
