import test from 'node:test';
import assert from 'node:assert/strict';
import {gunzipSync} from 'node:zlib';
import {deterministicModuleArchive} from '../../scripts/modules/archives.mjs';

test('module archives are stable across file order and preserve exact bytes',()=>{
  const first=deterministicModuleArchive([{path:'module/z.ts',bytes:Buffer.from('export const z = 1;\n')},
    {path:'README.md',bytes:Buffer.from('Hello\n')}]);
  const second=deterministicModuleArchive([{path:'README.md',bytes:Buffer.from('Hello\n')},
    {path:'module/z.ts',bytes:Buffer.from('export const z = 1;\n')}]);
  assert.deepEqual(first,second);
  assert.deepEqual([...first.subarray(4,8)],[0,0,0,0]);
  assert.equal(first[9],255);
  const tar=gunzipSync(first);
  assert.equal(tar.toString('utf8',0,9),'README.md');
  assert.equal(tar.toString('utf8',512,518),'Hello\n');
  assert.notDeepEqual(first,deterministicModuleArchive([{path:'README.md',bytes:Buffer.from('Changed\n')},
    {path:'module/z.ts',bytes:Buffer.from('export const z = 1;\n')}]));
});

test('long UTF-8 paths use a deterministic POSIX pax header',()=>{
  const name=`docs/${'é'.repeat(70)}.md`;
  const zipped=deterministicModuleArchive([{path:name,bytes:Buffer.from('texte\n')}]);
  const tar=gunzipSync(zipped);
  assert.equal(tar.toString('ascii',156,157),'x');
  assert.match(tar.toString('utf8',512,768),/path=docs\/é+/);
});
