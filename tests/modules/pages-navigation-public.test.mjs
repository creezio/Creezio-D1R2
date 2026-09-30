import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,lstat} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {composeRuntime} from '../../scripts/build/compose-runtime.mjs';
import {validateModule} from '../../sdk/contracts/validate.mjs';

const root=path.resolve(fileURLToPath(new URL('../..',import.meta.url)));
const quality=path.join(root,'.quality');
const manifest=JSON.parse(await readFile(path.join(root,'extensions/native/pages-navigation/module/manifest.json'),'utf8'));

test('selected Pages workspace module compiles a resolvable public projection',{timeout:30000},async()=>{
  const directory=await mkdtemp(path.join(quality,'t21-public-projection-'));
  assert.equal(path.dirname(directory),quality);
  assert.equal((await lstat(directory)).isSymbolicLink(),false);
  try{
    const result=await composeRuntime({root,outputDir:path.relative(root,directory)});
    assert.ok(result.outputs.some(item=>item.endsWith('/public-pages.ts')));
    const source=await readFile(path.join(directory,'public-pages.ts'),'utf8');
    assert.match(source,/publicPageProjection: PublicPageProjection \| null = Object\.freeze/);
    assert.match(source,/creezio\.pages-navigation/);
    assert.match(source,/\.\/public-page-renderer\.mjs/);
    assert.match(source,/published-images\.ts/);
    assert.match(source,/landing — styles du rendu public/);
    assert.match(source,/"public_page":"public_page"/);
    const renderer=await readFile(path.join(directory,'public-page-renderer.mjs'),'utf8');
    assert.doesNotMatch(renderer,/\b(?:eval\s*\(|new\s+Function\s*\(|import\s*\(|from\s*["']node:)/);
    const script=`const {renderPublicPage}=await import(${JSON.stringify(pathToFileURL(path.join(directory,'public-page-renderer.mjs')).href)});
      const page={slug:'/',title:'Témoin',sections:[{id:'hero',kind:'hero',enabled:true,position:0,content:{title:'Page publique'}}],
        settings:{},seo:{},publishedRevision:1};
      const html=renderPublicPage(page,[],'https://example.invalid','/* css */');
      if(!html.includes('<h1>Page publique</h1>'))throw new Error('public prefab missing');
      process.exit(0);`;
    execFileSync(process.execPath,['--conditions=react-server','--input-type=module','-e',script],{stdio:'pipe',timeout:10000});
  }finally{
    assert.equal(path.dirname(directory),quality);
    assert.equal((await lstat(directory)).isSymbolicLink(),false);
    await rm(directory,{recursive:true,force:true});
  }
});

test('public entrypoint rejects old SDK, foreign/public models and missing package stylesheet',()=>{
  const errorsFor=change=>{const candidate=structuredClone(manifest);change(candidate);
    return validateModule(candidate).errors;};
  assert.deepEqual(validateModule(manifest).errors,[]);
  assert.ok(errorsFor(candidate=>{candidate.compatibility.sdk='^1.5.0';})
    .some(error=>error.code==='public-page.sdk'));
  assert.ok(errorsFor(candidate=>{candidate.entrypoints.publicPage.models.publicPage.moduleId='foreign.module';})
    .some(error=>error.code==='public-page.model'));
  assert.ok(errorsFor(candidate=>{candidate.contracts.models.find(model=>model.id==='public_page').public=true;})
    .some(error=>error.code==='public-page.model'));
  assert.ok(errorsFor(candidate=>{candidate.packaging.runtime.files=
    candidate.packaging.runtime.files.filter(file=>file!=='ui/landing.css');})
    .some(error=>error.path.includes('/entrypoints/publicPage/stylesheet')));
});

test('composition without Pages emits no anonymous page renderer',{timeout:30000},async()=>{
  const directory=await mkdtemp(path.join(quality,'t21-public-absent-'));
  assert.equal(path.dirname(directory),quality);
  assert.equal((await lstat(directory)).isSymbolicLink(),false);
  try{
    await composeRuntime({root,outputDir:path.relative(root,directory)});
    assert.ok((await readFile(path.join(directory,'public-page-renderer.mjs'),'utf8')).length>0);
    await composeRuntime({root,compositionPath:'configuration/composition.widgets-local.json',
      outputDir:path.relative(root,directory)});
    const source=await readFile(path.join(directory,'public-pages.ts'),'utf8');
    assert.match(source,/publicPageProjection: PublicPageProjection \| null = null/);
    await assert.rejects(readFile(path.join(directory,'public-page-renderer.mjs'),'utf8'),{code:'ENOENT'});
  }finally{
    assert.equal(path.dirname(directory),quality);
    assert.equal((await lstat(directory)).isSymbolicLink(),false);
    await rm(directory,{recursive:true,force:true});
  }
});
