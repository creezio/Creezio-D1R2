import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {copyFileSync,mkdirSync,readFileSync,writeFileSync,unlinkSync} from 'node:fs';
import path from 'node:path';
import {temporaryDirectory} from '../quality/temporary.mjs';
import {preparePortableSource,verifyPortableSource} from '../../scripts/local/source-manifest.mjs';
import {sourceIdentity} from '../../scripts/quality/evidence.mjs';
import {buildDockerImage} from '../../adapters/docker/build.mjs';

function git(root,...args){return execFileSync('git',args,{cwd:root,encoding:'utf8',
  stdio:['ignore','pipe','pipe']}).trim();}
function fixture(t){
  const parent=temporaryDirectory(t,'creezio-docker-source-');
  const checkout=path.join(parent,'checkout'),image=path.join(parent,'image');
  mkdirSync(checkout);mkdirSync(image);
  writeFileSync(path.join(checkout,'.gitignore'),'.creezio/\n');
  writeFileSync(path.join(checkout,'app.mjs'),'export const version = 1;\n');
  git(checkout,'init','-q');git(checkout,'config','user.email','test@example.invalid');
  git(checkout,'config','user.name','Synthetic Fixture');
  git(checkout,'add','.gitignore','app.mjs');git(checkout,'commit','-qm','fixture');
  return {checkout,image};
}
function imageFrom(checkout,image,source){
  for(const file of source.files){
    const target=path.join(image,file.path);
    mkdirSync(path.dirname(target),{recursive:true});
    copyFileSync(path.join(checkout,file.path),target);
  }
  mkdirSync(path.join(image,'.creezio'));
  copyFileSync(path.join(checkout,'.creezio/docker-source.json'),
    path.join(image,'.creezio/docker-source.json'));
}

test('Docker source export binds exact clean Git checkout to complete image bytes without .git',async t=>{
  const {checkout,image}=fixture(t);
  const record=await preparePortableSource(checkout);
  assert.equal(record.source.head,git(checkout,'rev-parse','HEAD'));
  assert.equal(record.source.tree,git(checkout,'rev-parse','HEAD^{tree}'));
  assert.match(record.source.archiveDigest,/^[a-f0-9]{64}$/);
  imageFrom(checkout,image,record.source);
  assert.deepEqual(verifyPortableSource(image),sourceIdentity(checkout));
  assert.deepEqual(sourceIdentity(image),sourceIdentity(checkout));
  assert.equal(readFileSync(path.join(image,'.creezio/docker-source.json'),'utf8')
    .includes('test@example.invalid'),false);
});

test('source manifest CLI prepares and verifies without an import-cycle deadlock',t=>{
  const {checkout,image}=fixture(t);
  for(const file of ['local/source-manifest.mjs','quality/evidence.mjs']){
    const destination=path.join(checkout,'scripts',file);
    mkdirSync(path.dirname(destination),{recursive:true});
    copyFileSync(new URL(`../../scripts/${file}`,import.meta.url),destination);
  }
  git(checkout,'add','scripts');git(checkout,'commit','-qm','manifest CLI');
  const run=(root,mode)=>JSON.parse(execFileSync(process.execPath,
    [path.join(root,'scripts/local/source-manifest.mjs'),mode],
    {cwd:root,encoding:'utf8',timeout:15000,stdio:['ignore','pipe','pipe']}));
  const prepared=run(checkout,'prepare');
  assert.equal(prepared.head,git(checkout,'rev-parse','HEAD'));
  const record=JSON.parse(readFileSync(path.join(checkout,'.creezio/docker-source.json'),'utf8'));
  imageFrom(checkout,image,record.source);
  assert.equal(run(image,'verify').sha256,prepared.sha256);
});

test('portable identity refuses modified, absent and unlisted source rather than guessing provenance',async t=>{
  const {checkout,image}=fixture(t),record=await preparePortableSource(checkout);
  imageFrom(checkout,image,record.source);
  writeFileSync(path.join(image,'app.mjs'),'export const version = 2;\n');
  assert.throws(()=>sourceIdentity(image),error=>error.code==='source_changed');
  copyFileSync(path.join(checkout,'app.mjs'),path.join(image,'app.mjs'));
  unlinkSync(path.join(image,'app.mjs'));
  assert.throws(()=>sourceIdentity(image),error=>error.code==='inventory_mismatch');
  copyFileSync(path.join(checkout,'app.mjs'),path.join(image,'app.mjs'));
  writeFileSync(path.join(image,'unlisted.mjs'),'export default true;\n');
  assert.throws(()=>sourceIdentity(image),error=>error.code==='inventory_mismatch');
});

test('portable identity tolerates known generated runtime files at any depth but rejects a new application source',async t=>{
  const {checkout,image}=fixture(t),record=await preparePortableSource(checkout);
  imageFrom(checkout,image,record.source);
  mkdirSync(path.join(image,'sdk/dist'),{recursive:true});
  writeFileSync(path.join(image,'sdk/dist/index.js'),'export {};\n');
  writeFileSync(path.join(image,'next-env.d.ts'),'// generated\n');
  writeFileSync(path.join(image,'tsconfig.tsbuildinfo'),'generated');
  writeFileSync(path.join(image,'.dev.vars'),'runtime only');
  mkdirSync(path.join(image,'.vinext/dev'),{recursive:true});
  writeFileSync(path.join(image,'.vinext/dev/lock.json'),'{"pid":1}\n');
  mkdirSync(path.join(image,'.vinext/fonts'),{recursive:true});
  writeFileSync(path.join(image,'.vinext/fonts/cache.woff2'),'generated');
  assert.deepEqual(sourceIdentity(image),sourceIdentity(checkout));
  writeFileSync(path.join(image,'app.mjs'),'export const version = 2;\n');
  assert.throws(()=>sourceIdentity(image),error=>error.code==='source_changed');
  copyFileSync(path.join(checkout,'app.mjs'),path.join(image,'app.mjs'));
  mkdirSync(path.join(image,'app'));
  writeFileSync(path.join(image,'app/page.ts'),'export default null;\n');
  assert.throws(()=>sourceIdentity(image),error=>error.code==='inventory_mismatch');
});

test('Git failure with .git present never falls back to a portable manifest',async t=>{
  const {checkout,image}=fixture(t),record=await preparePortableSource(checkout);
  imageFrom(checkout,image,record.source);
  mkdirSync(path.join(image,'.git'));
  assert.throws(()=>sourceIdentity(image));
});

test('Git index flags cannot hide changed source bytes behind a clean HEAD',async t=>{
  const {checkout}=fixture(t),file=path.join(checkout,'app.mjs');
  git(checkout,'update-index','--assume-unchanged','app.mjs');
  writeFileSync(file,'export const version = 2;\n');
  assert.equal(git(checkout,'status','--porcelain'),'');
  assert.throws(()=>sourceIdentity(checkout),error=>error.code==='source_index_flags');
  await assert.rejects(preparePortableSource(checkout),error=>error.code==='source_index_flags');
  git(checkout,'update-index','--no-assume-unchanged','app.mjs');
  writeFileSync(file,'export const version = 1;\n');
  git(checkout,'update-index','--skip-worktree','app.mjs');
  assert.throws(()=>sourceIdentity(checkout),error=>error.code==='source_index_flags');
  await assert.rejects(preparePortableSource(checkout),error=>error.code==='source_index_flags');
});

test('official launcher prepares one manifest and invokes the existing Compose build once',async t=>{
  const {checkout}=fixture(t),calls=[];
  const result=await buildDockerImage({root:checkout,freeBytes:21*1024**3,
    run:(program,args,options)=>{calls.push({program,args,options});return {status:0};}});
  assert.equal(result.head,git(checkout,'rev-parse','HEAD'));
  assert.equal(calls.length,1);
  assert.equal(calls[0].program,'docker');
  assert.deepEqual(calls[0].args.slice(0,3),['compose','-f',path.join(checkout,'adapters/docker/compose.yaml')]);
  assert.deepEqual(calls[0].args.slice(3),['build','app']);
  writeFileSync(path.join(checkout,'app.mjs'),'dirty\n');
  await assert.rejects(buildDockerImage({root:checkout,freeBytes:21*1024**3,run:()=>{throw Error('must not run');}}),
    /clean Git checkout/);
  await assert.rejects(buildDockerImage({root:checkout,freeBytes:19*1024**3,run:()=>{throw Error('must not run');}}),
    /20 GiB/);
});
