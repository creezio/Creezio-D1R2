import '../../scripts/local-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync,existsSync,unlinkSync,rmdirSync} from 'node:fs';
import {rename} from 'node:fs/promises';
import path from 'node:path';
import {temporaryDirectory} from '../quality/temporary.mjs';
import {sourceIdentity} from '../../scripts/quality/evidence.mjs';
import {measureRuntimeArtifacts} from '../../scripts/quality/runtime.mjs';
import {createCloudflareBuildPort,superviseDeliveryOperations} from '../../scripts/cloudflare/local-service.mjs';
import {cloudflareArtifactRoot} from '../../scripts/cloudflare/artifact-path.mjs';

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
function separateVolumeMoves(root){
  const volume=path.join(root,'.wrangler');
  const inVolume=value=>value===volume||value.startsWith(`${volume}${path.sep}`);
  return async(from,to)=>{
    if(inVolume(from)!==inVolume(to))throw Object.assign(new Error('Cross-device move'),{code:'EXDEV'});
    await rename(from,to);
  };
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
    move:separateVolumeMoves(f.root),
    run:async root=>{runs++;assert.equal(existsSync(path.join(root,'dist')),false);
      built(root,f.input.projection.targetPlan.compositionDigest);
      mkdirSync(path.join(root,'dist/client/generated-empty/nested'),{recursive:true});}});
  const artifact=await port(f.input);
  assert.equal(runs,1);
  assert.equal(readFileSync(path.join(f.root,'dist/server/index.js'),'utf8'),'local build');
  assert.equal(readFileSync(path.join(f.artifactRoot,'dist/server/index.js'),'utf8'),'cloudflare build');
  assert.equal(existsSync(path.join(f.artifactRoot,'.quality/cloudflare-build.json')),true);
  assert.equal(existsSync(path.join(f.root,'.quality/delivery-build/local-dist')),false);
  assert.equal(existsSync(path.join(f.root,'.quality/cloudflare-build.json')),false);
  assert.equal(existsSync(path.join(f.root,'.wrangler/delivery/build/artifact-staging')),false);
  assert.equal(artifact.artifactDigest,measureRuntimeArtifacts(f.artifactRoot).digest);
  assert.deepEqual(await port(f.input),artifact);
  assert.equal(runs,1);
  const reuseWithLowSpace=createCloudflareBuildPort({root:f.root},{freeBytes:async()=>0,
    run:()=>{throw new Error('must not rebuild');}});
  assert.deepEqual(await reuseWithLowSpace(f.input),artifact);
  await assert.rejects(port({...f.input,transferId:'another-transfer'}),
    error=>error.code==='artifact_exists');
});

test('a fresh Docker overlay copies the complete build to its distinct state volume',async t=>{
  const f=fixture(t);
  unlinkSync(path.join(f.root,'dist/server/index.js'));
  rmdirSync(path.join(f.root,'dist/server'));
  rmdirSync(path.join(f.root,'dist'));
  const port=createCloudflareBuildPort({root:f.root},{freeBytes:async()=>21*gigabytes,
    move:separateVolumeMoves(f.root),
    run:async root=>built(root,f.input.projection.targetPlan.compositionDigest)});
  const result=await port(f.input);
  assert.equal(result.artifactDigest,measureRuntimeArtifacts(f.artifactRoot).digest);
  assert.equal(existsSync(path.join(f.root,'dist')),false);
  assert.equal(existsSync(path.join(f.root,'.quality/cloudflare-build.json')),false);
  assert.equal(existsSync(path.join(f.artifactRoot,'receipt.json')),true);
});

test('code update builds into its own verified artifact without replacing the initial artifact',async t=>{
  const f=fixture(t),updateId='11111111-1111-4111-8111-111111111111';
  let runs=0,stops=0;
  const port=createCloudflareBuildPort({root:f.root},{freeBytes:async()=>21*gigabytes,
    move:separateVolumeMoves(f.root),run:async root=>{
      runs++;built(root,f.input.projection.targetPlan.compositionDigest);
      writeFileSync(path.join(root,'dist/server/index.js'),`cloudflare build ${runs}`);
      writeFileSync(path.join(root,'.quality/cloudflare-build.json'),JSON.stringify({
        source:sourceIdentity(root),artifact:measureRuntimeArtifacts(root),
        compositionDigest:f.input.projection.targetPlan.compositionDigest}));
    }});
  const original=await port(f.input),initialBytes=readFileSync(path.join(f.artifactRoot,'dist/server/index.js'));
  const updateInput={...f.input,transferId:updateId,updateId,
    artifactRoot:cloudflareArtifactRoot(f.root,updateId),beforeBuild:async()=>{stops++;}};
  const next=await port(updateInput),nextRoot=cloudflareArtifactRoot(f.root,updateId);
  assert.equal(runs,2);
  assert.equal(stops,1);
  assert.equal(original.artifactDigest,measureRuntimeArtifacts(f.artifactRoot).digest);
  assert.deepEqual(readFileSync(path.join(f.artifactRoot,'dist/server/index.js')),initialBytes);
  assert.equal(next.artifactDigest,measureRuntimeArtifacts(nextRoot).digest);
  assert.equal(readFileSync(path.join(nextRoot,'dist/server/index.js'),'utf8'),'cloudflare build 2');
  assert.equal(readFileSync(path.join(f.root,'dist/server/index.js'),'utf8'),'local build');
  assert.deepEqual(await port(updateInput),next);
  assert.equal(runs,2);
  assert.equal(stops,1);
  await assert.rejects(port({...updateInput,updateId:'../outside'}),
    error=>error.code==='invalid_artifact_identity');
  await assert.rejects(port({...updateInput,transferId:'different'}),
    error=>error.code==='invalid_artifact_identity');
});

test('update operation restarts the local runtime only after safe completion',async()=>{
  let starts=0;
  const supervisor={closing:false,start:()=>{starts++;}};
  const safe=superviseDeliveryOperations({startUpdate:async()=>({phase:'delivered'})},supervisor);
  assert.deepEqual(await safe.startUpdate(),{phase:'delivered'});
  assert.equal(starts,1);
  const unsafe=superviseDeliveryOperations({reconcileUpdate:async()=>{
    throw Object.assign(new Error('Old dist needs recovery'),{code:'build_recovery_required'});
  }},supervisor);
  await assert.rejects(unsafe.reconcileUpdate(),{code:'build_recovery_required'});
  assert.equal(starts,1);
});

test('an old partial artifact is refused without rebuilding or overwriting it',async t=>{
  const f=fixture(t);
  mkdirSync(path.join(f.artifactRoot,'.quality'),{recursive:true});
  const port=createCloudflareBuildPort({root:f.root},{freeBytes:async()=>21*gigabytes,
    run:()=>assert.fail('partial artifact must be inspected before another build')});
  await assert.rejects(port(f.input),error=>error.code==='artifact_exists');
  assert.equal(existsSync(path.join(f.artifactRoot,'.quality')),true);
  assert.equal(readFileSync(path.join(f.root,'dist/server/index.js'),'utf8'),'local build');
});

test('unmeasured build files refuse publication before the active local build is restored',async t=>{
  const f=fixture(t);
  const port=createCloudflareBuildPort({root:f.root},{freeBytes:async()=>21*gigabytes,
    move:separateVolumeMoves(f.root),run:async root=>{
      built(root,f.input.projection.targetPlan.compositionDigest);
      writeFileSync(path.join(root,'dist/other.txt'),'unmeasured');
    }});
  await assert.rejects(port(f.input),error=>error.code==='build_recovery_required');
  assert.equal(existsSync(f.artifactRoot),false);
  assert.equal(readFileSync(path.join(f.root,'dist/server/index.js'),'utf8'),'local build');
  assert.equal(readFileSync(path.join(f.root,'.quality/delivery-build/failed-dist/other.txt'),'utf8'),'unmeasured');
});

test('a report cleanup failure still restores the old build after verified publication',async t=>{
  const f=fixture(t);
  const port=createCloudflareBuildPort({root:f.root},{freeBytes:async()=>21*gigabytes,
    move:separateVolumeMoves(f.root),run:async root=>built(root,f.input.projection.targetPlan.compositionDigest),
    removeReport:async()=>{throw Object.assign(new Error('Synthetic report permission failure'),{code:'EACCES'});}});
  await assert.rejects(port(f.input),error=>error.code==='artifact_cleanup_failed');
  assert.equal(readFileSync(path.join(f.root,'dist/server/index.js'),'utf8'),'local build');
  assert.equal(existsSync(path.join(f.root,'.quality/delivery-build/local-dist')),false);
  assert.equal(existsSync(path.join(f.root,'.quality/cloudflare-build.json')),true);
  assert.equal(existsSync(path.join(f.artifactRoot,'receipt.json')),true);
});

test('a residual generated build preserves the old build and prevents automatic runtime restart',async t=>{
  const f=fixture(t),staging=path.join(f.root,'.wrangler/delivery/build/artifact-staging');
  const moveWithinVolume=separateVolumeMoves(f.root);
  const port=createCloudflareBuildPort({root:f.root},{freeBytes:async()=>21*gigabytes,
    run:async root=>built(root,f.input.projection.targetPlan.compositionDigest),
    move:async(from,to)=>{
      await moveWithinVolume(from,to);
      if(from===staging&&to===f.artifactRoot)
        writeFileSync(path.join(f.root,'dist/foreign.txt'),'arrived during cleanup');
    }});
  let starts=0;
  const operations=superviseDeliveryOperations({start:()=>port(f.input),reconcile:()=>port(f.input)},
    {closing:false,start:()=>{starts++;}});
  await assert.rejects(operations.start(),error=>error.code==='build_recovery_required');
  assert.equal(starts,0);
  assert.equal(readFileSync(path.join(f.root,'dist/foreign.txt'),'utf8'),'arrived during cleanup');
  assert.equal(readFileSync(path.join(f.root,'.quality/delivery-build/local-dist/server/index.js'),'utf8'),
    'local build');
  assert.equal(existsSync(path.join(f.artifactRoot,'receipt.json')),true);
});

test('failed Cloudflare build restores local dist and reuses one staging directory',async t=>{
  const f=fixture(t);
  const failed=createCloudflareBuildPort({root:f.root},{freeBytes:async()=>21*gigabytes,
    run:async root=>{mkdirSync(path.join(root,'dist/server'),{recursive:true});
      writeFileSync(path.join(root,'dist/server/index.js'),'partial build');
      throw Object.assign(new Error('Build failed.'),{code:'build_failed'});}});
  await assert.rejects(failed(f.input),error=>error.code==='build_failed');
  assert.equal(readFileSync(path.join(f.root,'dist/server/index.js'),'utf8'),'local build');
  assert.equal(existsSync(path.join(f.root,'.quality/delivery-build/failed-dist')),true);
  const retried=createCloudflareBuildPort({root:f.root},{freeBytes:async()=>21*gigabytes,
    run:async root=>{assert.equal(readFileSync(path.join(root,'dist/server/index.js'),'utf8'),'partial build');
      built(root,f.input.projection.targetPlan.compositionDigest);}});
  await retried(f.input);
  assert.equal(readFileSync(path.join(f.root,'dist/server/index.js'),'utf8'),'local build');
  assert.equal(existsSync(path.join(f.root,'.quality/delivery-build/failed-dist')),false);
  assert.equal(existsSync(path.join(f.artifactRoot,'dist/server/index.js')),true);
});

test('an interrupted destination publication resumes its verified staging without a cross-volume rename',async t=>{
  const f=fixture(t),staging=path.join(f.root,'.wrangler/delivery/build/artifact-staging');
  const moveWithinVolume=separateVolumeMoves(f.root);
  let interrupted=false,runs=0;
  const first=createCloudflareBuildPort({root:f.root},{freeBytes:async()=>21*gigabytes,
    run:async root=>{runs++;built(root,f.input.projection.targetPlan.compositionDigest);},
    move:async(from,to)=>{
      if(from===staging&&to===f.artifactRoot&&!interrupted){interrupted=true;
        throw Object.assign(new Error('Interrupted after staged copy'),{code:'EIO'});}
      await moveWithinVolume(from,to);
    }});
  await assert.rejects(first(f.input),error=>error.code==='EIO');
  assert.equal(existsSync(f.artifactRoot),false);
  assert.equal(readFileSync(path.join(staging,'dist/server/index.js'),'utf8'),'cloudflare build');
  assert.equal(readFileSync(path.join(f.root,'dist/server/index.js'),'utf8'),'local build');
  assert.equal(existsSync(path.join(f.root,'.quality/delivery-build/failed-dist')),true);
  const retry=createCloudflareBuildPort({root:f.root},{freeBytes:async()=>21*gigabytes,
    move:moveWithinVolume,run:async root=>{runs++;built(root,f.input.projection.targetPlan.compositionDigest);}});
  writeFileSync(path.join(staging,'dist/server/index.js'),'foreign bytes');
  await assert.rejects(retry(f.input),error=>error.code==='artifact_stage_conflict');
  assert.equal(readFileSync(path.join(staging,'dist/server/index.js'),'utf8'),'foreign bytes');
  assert.equal(readFileSync(path.join(f.root,'dist/server/index.js'),'utf8'),'local build');
  writeFileSync(path.join(staging,'dist/server/index.js'),'cloudflare build');
  const result=await retry(f.input);
  assert.equal(runs,3);
  assert.equal(result.artifactDigest,measureRuntimeArtifacts(f.artifactRoot).digest);
  assert.equal(existsSync(staging),false);
  assert.equal(existsSync(path.join(f.root,'.quality/delivery-build/failed-dist')),false);
  assert.equal(readFileSync(path.join(f.root,'dist/server/index.js'),'utf8'),'local build');
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
