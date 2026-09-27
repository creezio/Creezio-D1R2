import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeInstalledDocument,installedDocumentDigest,splitInstalledDocumentContent,
  installedDocumentMetadata,readInstalledDocumentBlock,verifyInstalledDocumentContent,
  INSTALLED_DOCUMENT_LIMITS} from '../../sdk/modules/documents.ts';

test('installed documentation preserves UTF-8 BOM and binds exact bytes',()=>{
  const bytes=Uint8Array.from([0xef,0xbb,0xbf,...new TextEncoder().encode('Bonjour é\n')]);
  const content=decodeInstalledDocument(bytes);
  assert.equal(content,'\ufeffBonjour é\n');
  const metadata={moduleId:'test',origin:'https://example.test',version:'1.0.0',sourceRevision:'abc',
    runtimeIntegrity:'sha256-runtime',kind:'readme',visibility:'public',path:'README.md',
    digest:installedDocumentDigest(bytes),byteLength:bytes.byteLength,blockCount:1};
  const document={...metadata,content};
  assert.equal(verifyInstalledDocumentContent(metadata,content),true);
  assert.deepEqual(installedDocumentMetadata(document),metadata);
  assert.deepEqual(readInstalledDocumentBlock(document,0),{document:metadata,blockIndex:0,
    content,nextBlockIndex:null});
  assert.equal(verifyInstalledDocumentContent({...metadata,digest:'sha256-stale'},content),false);
  assert.throws(()=>decodeInstalledDocument(Uint8Array.from([0xc3,0x28])),{code:'utf8'});
});

test('blocks stay within 16 KiB and split only between Unicode scalars',()=>{
  const content='🙂'.repeat(4100);
  const blocks=splitInstalledDocumentContent(content);
  assert.equal(blocks.length,2);
  assert.equal(blocks.join(''),content);
  for (const block of blocks) assert.ok(new TextEncoder().encode(block).byteLength<=INSTALLED_DOCUMENT_LIMITS.blockBytes);
  const bytes=new TextEncoder().encode(content);
  const document={moduleId:'test',origin:'https://example.test',version:'1.0.0',sourceRevision:'abc',
    runtimeIntegrity:'sha256-runtime',kind:'prd',visibility:'restricted',path:'prd.md',
    digest:installedDocumentDigest(bytes),byteLength:bytes.byteLength,blockCount:blocks.length,content};
  assert.equal(readInstalledDocumentBlock(document,0).nextBlockIndex,1);
  assert.equal(readInstalledDocumentBlock(document,1).nextBlockIndex,null);
  assert.throws(()=>readInstalledDocumentBlock(document,2),{code:'block_index'});
  assert.throws(()=>splitInstalledDocumentContent('x'.repeat(INSTALLED_DOCUMENT_LIMITS.documentBytes+1)),{code:'document_size'});
});
