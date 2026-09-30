import test from 'node:test';
import assert from 'node:assert/strict';
import {copyFileSync,lstatSync,mkdirSync,mkdtempSync,readFileSync,realpathSync,rmSync,
  readdirSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {composeRuntime} from '../../scripts/build/compose-runtime.mjs';
import {contractIntegrity} from '../../sdk/contracts/validate.mjs';

const repository=fileURLToPath(new URL('../../',import.meta.url));
const read=relative=>JSON.parse(readFileSync(path.join(repository,relative),'utf8'));
const write=(target,value)=>writeFileSync(target,JSON.stringify(value,null,2)+'\n');
const id='creezio.catalog:catalog-products';

function scratch(t){
  const parent=realpathSync(path.join(repository,'.quality'));
  const root=mkdtempSync(path.join(parent,'search-composition-'));
  t.after(()=>{
    assert.equal(path.dirname(realpathSync(root)),parent);
    assert.ok(path.basename(root).startsWith('search-composition-'));
    const scan=target=>{const stat=lstatSync(target);
      assert.equal(stat.isSymbolicLink(),false);
      if(stat.isDirectory())for(const name of readdirSync(target))scan(path.join(target,name));};
    scan(root);
    if(process.platform==='win32')execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',
      '$ErrorActionPreference="Stop"; $target=[IO.Path]::GetFullPath($env:CREEZIO_SEARCH_TMP); '+
      '$parent=[IO.Path]::GetFullPath($env:CREEZIO_SEARCH_PARENT); '+
      'if ([IO.Path]::GetDirectoryName($target) -ne $parent) { throw "Containment failed" }; '+
      'Remove-Item -LiteralPath $target -Recurse -Force'],
    {env:{...process.env,CREEZIO_SEARCH_TMP:root,CREEZIO_SEARCH_PARENT:parent},stdio:'pipe'});
    else rmSync(root,{recursive:true,force:true});
  });
  return root;
}

function fixture(t,{selected=true,enabled=true,second=false}={}){
  const root=scratch(t),relative=path.relative(repository,root).split(path.sep).join('/');
  const composition=read('configuration/composition.connectors.json');
  const lock=read('configuration/composition.connectors.lock.json');
  const wanted=new Set(['creezio.access','creezio.catalog',...(selected?['creezio.meili']:[])]);
  composition.modules=composition.modules.filter(item=>wanted.has(item.moduleId));
  lock.modules=lock.modules.filter(item=>wanted.has(item.moduleId));
  composition.front={kind:'workspace'};
  for(const audience of ['admin','app'])composition.exposure[audience].moduleIds=
    composition.exposure[audience].moduleIds.filter(moduleId=>wanted.has(moduleId)
      &&(moduleId!=='creezio.meili'||enabled));
  const catalogSelection=composition.modules.find(item=>item.moduleId==='creezio.catalog');
  catalogSelection.integrations=[{moduleId:'creezio.meili',enabled:selected&&enabled}];
  const meiliSelection=composition.modules.find(item=>item.moduleId==='creezio.meili');
  if(meiliSelection){meiliSelection.versionRange='^0.3.0';meiliSelection.enabled=enabled;}
  const manifests=new Map(composition.modules.map(selection=>[selection.moduleId,
    read(`${selection.source.path}/module/manifest.json`)]));
  if(second){
    const source=path.join(repository,catalogSelection.source.path),destination=path.join(root,'catalog');
    const catalog=manifests.get('creezio.catalog');
    for(const file of catalog.packaging.runtime.files){
      const target=path.join(destination,file);mkdirSync(path.dirname(target),{recursive:true});
      copyFileSync(path.join(source,file),target);
    }
    catalog.contracts.search.push({...structuredClone(catalog.contracts.search[0]),id:'catalog-products-alt'});
    write(path.join(destination,'module/manifest.json'),catalog);
    catalogSelection.source.path=`${relative}/catalog`;
  }
  for(const node of lock.modules){const manifest=manifests.get(node.moduleId);
    node.version=manifest.identity.version;node.source=manifest.identity.source;
    node.contractIntegrity=contractIntegrity(manifest);
    node.dependencies=manifest.dependencies.filter(dep=>wanted.has(dep.moduleId)).map(dep=>({
      moduleId:dep.moduleId,version:manifests.get(dep.moduleId).identity.version}));
  }
  lock.compositionIntegrity=contractIntegrity(composition);
  const compositionPath=`${relative}/composition.json`,lockPath=`${relative}/composition.lock.json`;
  write(path.join(root,'composition.json'),composition);
  write(path.join(root,'composition.lock.json'),lock);
  return {root,compositionPath,lockPath,outputDir:`${relative}/generated`};
}

async function compiled(t,options){
  const f=fixture(t,options);
  await composeRuntime({root:repository,compositionPath:f.compositionPath,lockPath:f.lockPath,
    outputDir:f.outputDir});
  const source=readFileSync(path.join(f.root,'generated/provider-catalog.ts'),'utf8');
  const literal=source.match(/^export const searchProjections = freeze\((\[[^\r\n]*\])\);$/m)?.[1];
  assert.ok(literal,'generated provider catalogue must include compiled search projections');
  return JSON.parse(literal);
}

test('selected Meili integration compiles the canonical owner-qualified source',async t=>{
  const projections=await compiled(t);
  assert.deepEqual(projections.map(item=>item.moduleId),['creezio.meili']);
  assert.deepEqual(projections[0].sources.map(source=>source.id),[id]);
  assert.deepEqual(projections[0].sources[0].facets,['category_id']);
});

test('disabled integration and removed provider leave no search projection',async t=>{
  assert.deepEqual(await compiled(t,{enabled:false}),[]);
  assert.deepEqual(await compiled(t,{selected:false}),[]);
});

test('two active declarations compile into two distinct sources for the same provider',async t=>{
  const projections=await compiled(t,{second:true});
  assert.deepEqual(projections[0].sources.map(source=>source.id),
    [id,'creezio.catalog:catalog-products-alt']);
  assert.ok(projections[0].sources.every(source=>source.moduleId==='creezio.catalog'
    &&source.permissionId==='view'));
});
