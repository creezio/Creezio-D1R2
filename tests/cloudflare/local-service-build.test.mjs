import '../../scripts/local-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import path from 'node:path';
import {temporaryDirectory} from '../quality/temporary.mjs';
import {sourceIdentity} from '../../scripts/quality/evidence.mjs';
import {measureRuntimeArtifacts} from '../../scripts/quality/runtime.mjs';
import {createCloudflareBuildPort} from '../../scripts/cloudflare/local-service.mjs';

const gigabytes=1024**3;
function git(root,...args){return execFileSync('git',args,{cwd:root,encoding:'utf8',
  stdio:['ignore','pipe','pipe']}).trim();}
function fixture(t){
  const root=temporaryDirectory(t,'creezio-local-cloudflare-build-');
  writeFileSync(path.join(root,'.gitignore'),'.wrangler/\n.quality/\ndist/\n');
  writeFileSync(path.join(root,'app.mjs'),'export default true;\n');
  git(root,'init','-q');git(root,'config','user.email','test@example.invalid');
  git(root,'config','user.name','Synthetic Fixture');git(root,'add','.gitignore','app.mjs');
  git(root,'commit','-qm','fixture');
  mkdirSync(path.join(root,'dist/server'),{recursive:true});
  writeFileSync(path.join(root,'dist/server/index.js'),'local build');
  const sourceSha=sourceIdentity(root).head,
    target={workerName:'cloudflare-test',accountId:'a'.repeat(32)},
    projection={composition:{schemaVersion:'1.0.0',sdk:{coreVersion:'1.0.0'}},lock:{},
      targetPlan:{compositionDigest:`sha256-${'b'.repeat(64)}`}},
    input={target,projection,sourceSha,transferId:'transfer-one'},
    artifactRoot=path.join(root,'.wrangler/delivery/build/artifact');
  return {root,input,artifactRoot};
}
function built(root,compositionDigest){
  mkdirSync(path.join(root,'dist/server'),{recursive:true});
  mkdirSync(path.join(root,'dist/client'),{recursive:true});
  writeFileSync(path.join(root,'dist/server/index.js'),'cloudflare build');
  writeFileSync(path.join(root,'dist/client/index.html'),'<p>Cloudflare</p>');
  mkdirSync(path.join(root,'.quality'),{recursive:true});
  writeFileSync(path.join(root,'.quality/cloudflare-build.json'),JSON.stringify({
    source:sourceIdentity(root),artifact:measureRuntimeArtifacts(root),compositionDigest}));
}

test('Cloudflare build keeps the active local dist and a stable artifact for reconciliation',async t=>{
  const f=fixture(t);let runs=0;
  const port=createCloudflareBuildPort({root:f.root},{freeBytes:async()=>21*gigabytes,
    run:async root=>{runs++;assert.equal(existsSync(path.join(root,'dist')),false);
      built(root,f.input.projection.targetPlan.compositionDigest);}});
  const artifact=await port(f.input);
  assert.equal(runs,1);
  assert.equal(readFileSync(path.join(f.root,'dist/server/index.js'),'utf8'),'local build');
  assert.equal(readFileSync(path.join(f.artifactRoot,'dist/server/index.js'),'utf8'),'cloudflare build');
  assert.equal(existsSync(path.join(f.artifactRoot,'.quality/cloudflare-build.json')),true);
  assert.equal(existsSync(path.join(f.root,'.wrangler/delivery/build/local-dist')),false);
  assert.equal(artifact.artifactDigest,measureRuntimeArtifacts(f.artifactRoot).digest);
  assert.deepEqual(await port(f.input),artifact);
  assert.equal(runs,1);
  const reuseWithLowSpace=createCloudflareBuildPort({root:f.root},{freeBytes:async()=>0,
    run:()=>{throw new Error('must not rebuild');}});
  assert.deepEqual(await reuseWithLowSpace(f.input),artifact);
  await assert.rejects(port({...f.input,transferId:'another-transfer'}),
    error=>error.code==='artifact_exists');
});

test('failed Cloudflare build restores local dist and reuses one staging directory',async t=>{
  const f=fixture(t);
  const failed=createCloudflareBuildPort({root:f.root},{freeBytes:async()=>21*gigabytes,
    run:async root=>{mkdirSync(path.join(root,'dist/server'),{recursive:true});
      writeFileSync(path.join(root,'dist/server/index.js'),'partial build');
      throw Object.assign(new Error('Build failed.'),{code:'build_failed'});}});
  await assert.rejects(failed(f.input),error=>error.code==='build_failed');
  assert.equal(readFileSync(path.join(f.root,'dist/server/index.js'),'utf8'),'local build');
  assert.equal(existsSync(path.join(f.root,'.wrangler/delivery/build/failed-dist')),true);
  const retried=createCloudflareBuildPort({root:f.root},{freeBytes:async()=>21*gigabytes,
    run:async root=>{assert.equal(readFileSync(path.join(root,'dist/server/index.js'),'utf8'),'partial build');
      built(root,f.input.projection.targetPlan.compositionDigest);}});
  await retried(f.input);
  assert.equal(readFileSync(path.join(f.root,'dist/server/index.js'),'utf8'),'local build');
  assert.equal(existsSync(path.join(f.root,'.wrangler/delivery/build/failed-dist')),false);
  assert.equal(existsSync(path.join(f.artifactRoot,'dist/server/index.js')),true);
});

test('one service cannot run overlapping builds against the same dist',async t=>{
  const f=fixture(t);let entered,release;
  const ready=new Promise(resolve=>{entered=resolve;});
  const blocked=new Promise(resolve=>{release=resolve;});
  const port=createCloudflareBuildPort({root:f.root},{freeBytes:async()=>21*gigabytes,
    run:async root=>{entered();await blocked;
      built(root,f.input.projection.targetPlan.compositionDigest);}});
  const first=port(f.input);await ready;
  await assert.rejects(port(f.input),error=>error.code==='build_busy');
  release();await first;
  assert.equal(readFileSync(path.join(f.root,'dist/server/index.js'),'utf8'),'local build');
});
