import test from 'node:test';
import assert from 'node:assert/strict';
import {documentsList,documentsRead} from '../../extensions/native/modules-settings/module/documentation.ts';
import {installedDocumentDigest,splitInstalledDocumentContent} from '../../sdk/modules/documents.ts';
import {contractIntegrity} from '../../sdk/contracts/semantics.mjs';

function fixture() {
  const content='\uFEFF'+'é😀'.repeat(5000), bytes=new TextEncoder().encode(content);
  const common={moduleId:'module.one',origin:'https://example.invalid/module',version:'1.0.0',
    sourceRevision:'revision-1',runtimeIntegrity:'sha256-'+'a'.repeat(64),visibility:'public',
    digest:installedDocumentDigest(bytes),byteLength:bytes.byteLength,
    blockCount:splitInstalledDocumentContent(content).length,content};
  const documents=['readme','prd','changelog'].map(kind=>({...common,kind,path:`${kind}.md`}));
  const composition={modules:[{moduleId:'module.one',enabled:false}]},lock={modules:[{moduleId:'module.one'}]};
  const context={hostInventory:{current:{composition,lock,descriptors:[]},inventory:{},
    currentInstalledDocuments:documents}};
  return {context,documents,content,composition,lock};
}

test('installed documentation lists exactly the captured version and reads bounded UTF-8 blocks',()=>{
  const {context,documents,content,composition,lock}=fixture();
  const output=documentsList({moduleId:'module.one'},context).output;
  assert.deepEqual(output.documents.map(item=>item.kind),['readme','prd','changelog']);
  assert.equal(output.compositionDigest,contractIntegrity(composition));
  assert.equal(output.lockDigest,contractIntegrity(lock));
  assert.equal(output.documents[0].content,undefined);
  const metadata=output.documents[1], chunks=[];
  for(let blockIndex=0;blockIndex<metadata.blockCount;blockIndex++) {
    const block=documentsRead({moduleId:'module.one',kind:'prd',digest:metadata.digest,
      runtimeIntegrity:metadata.runtimeIntegrity,blockIndex},context).output;
    assert.deepEqual(block.document,metadata);
    assert.equal(block.blockIndex,blockIndex);
    assert.equal(block.nextBlockIndex,blockIndex+1<metadata.blockCount?blockIndex+1:null);
    assert.ok(new TextEncoder().encode(block.content).byteLength<=16_384);
    chunks.push(block.content);
  }
  assert.equal(chunks.join(''),content);
  assert.equal(documents[1].content.charCodeAt(0),0xFEFF);
});

test('installed documentation rejects stale versions, absent modules and invalid blocks',()=>{
  const {context,documents}=fixture(), first=documents[0];
  const input={moduleId:'module.one',kind:'readme',digest:first.digest,
    runtimeIntegrity:first.runtimeIntegrity,blockIndex:0};
  assert.throws(()=>documentsRead({...input,digest:'sha256-'+'b'.repeat(64)},context),
    error=>error.code==='conflict');
  assert.throws(()=>documentsRead({...input,runtimeIntegrity:'sha256-'+'b'.repeat(64)},context),
    error=>error.code==='conflict');
  assert.throws(()=>documentsRead({...input,blockIndex:first.blockCount},context),
    error=>error.code==='invalid_input');
  assert.throws(()=>documentsList({moduleId:'module.absent'},context),
    error=>error.code==='not_found');
  assert.throws(()=>documentsRead({...input,moduleId:'module.absent'},context),
    error=>error.code==='not_found');
  assert.throws(()=>documentsRead({...input,kind:'agents'},context),
    error=>error.code==='invalid_input');
  assert.throws(()=>documentsList({moduleId:'module.one'},{}),
    error=>error.code==='unavailable');
});
