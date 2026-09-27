import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {existsSync,lstatSync,mkdirSync,readFileSync,readdirSync,renameSync,unlinkSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {sourceIdentity} from '../quality/evidence.mjs';

const RELATIVE='.creezio/docker-source.json';
const LIMIT=8*1024*1024;
const SHA40=/^[a-f0-9]{40}$/;
const SHA64=/^[a-f0-9]{64}$/;
const SKIP=new Set(['.git','.quality','.creezio','.wrangler','.vinext','node_modules','dist','coverage',
  '.next','.cache','outputs','work','private','docker-data']);
const skip=name=>SKIP.has(name)||name.startsWith('.next-');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=code=>{throw Object.assign(new Error(`Portable source ${code}.`),{code});};
const sourcePath=root=>path.join(root,RELATIVE);
function safeName(value){
  return typeof value==='string'&&value.length>0&&value.length<=1024&&!value.includes('\\')
    &&!value.startsWith('/')&&!value.includes(':')&&value.split('/').every(part=>part&&part!=='.'&&part!=='..');
}
function sourceFile(root,name){
  if(!safeName(name)||name.split('/').some(skip))fail('invalid_path');
  const absolute=path.resolve(root,name),relative=path.relative(root,absolute);
  if(relative!==name.split('/').join(path.sep))fail('invalid_path');
  for(let cursor=absolute;cursor!==path.dirname(root);cursor=path.dirname(cursor)){
    const stat=lstatSync(cursor,{throwIfNoEntry:false});
    if(!stat||stat.isSymbolicLink())fail('invalid_path');
  }
  const stat=lstatSync(absolute);
  if(!stat.isFile()||stat.size>128*1024*1024)fail('invalid_file');
  return absolute;
}
function listing(root,sourceNames){
  const result=[];
  const recorded=new Set(sourceNames);
  const generated=(name,relative)=>!recorded.has(relative)&&(
    name==='next-env.d.ts'||name.endsWith('.tsbuildinfo')||name==='.dev.vars'
    ||name.startsWith('.dev.vars.')||name==='.env'||name.startsWith('.env.')
    ||name.endsWith('.log'));
  function walk(directory,prefix=''){
    for(const entry of readdirSync(directory,{withFileTypes:true})){
      const name=prefix?`${prefix}/${entry.name}`:entry.name;
      if(skip(entry.name)||entry.isFile()&&generated(entry.name,name))continue;
      if(entry.isSymbolicLink())fail('linked_source');
      if(entry.isDirectory()){walk(path.join(directory,entry.name),name);continue;}
      if(!entry.isFile()||!safeName(name))fail('invalid_file');
      result.push(name);
      if(result.length>20000)fail('inventory_limit');
    }
  }
  walk(root);return result.sort();
}
function checkedManifest(root){
  const target=sourcePath(root);
  for(let cursor=target;cursor!==path.dirname(root);cursor=path.dirname(cursor)){
    const stat=lstatSync(cursor,{throwIfNoEntry:false});
    if(!stat||stat.isSymbolicLink())fail('manifest_path');
  }
  const stat=lstatSync(target);
  if(!stat.isFile()||stat.size>LIMIT)fail('manifest_limit');
  let record;
  try{record=JSON.parse(readFileSync(target,'utf8'));}catch{fail('manifest_json');}
  const source=record?.source;
  if(record.schemaVersion!==1||Object.keys(record).sort().join(',')!=='schemaVersion,source'||
    !source||Object.keys(source).sort().join(',')!=='archiveDigest,dirty,files,head,sha256,tree'||
    !SHA40.test(source.head??'')||!SHA40.test(source.tree??'')||
    !SHA64.test(source.sha256??'')||!SHA64.test(source.archiveDigest??'')||
    source.dirty!==false||!Array.isArray(source.files)||source.files.length>20000)fail('manifest_contract');
  const names=source.files.map(item=>item?.path);
  if(names.some(name=>!safeName(name)||name.split('/').some(skip))||
    names.some((name,index)=>index>0&&names[index-1]>=name)||
    source.files.some(item=>!item||Object.keys(item).sort().join(',')!=='path,sha256'||
      !SHA64.test(item.sha256??'')))fail('manifest_inventory');
  return source;
}

/** Synchronous so sourceIdentity can use it only when .git is absent. */
export function verifyPortableSource(root){
  root=path.resolve(root);
  if(existsSync(path.join(root,'.git')))fail('git_present');
  const source=checkedManifest(root),actual=listing(root,source.files.map(item=>item.path));
  if(actual.length!==source.files.length||actual.some((name,index)=>name!==source.files[index].path))
    fail('inventory_mismatch');
  const aggregate=createHash('sha256');
  const files=[];
  for(const item of source.files){
    const digest=hash(readFileSync(sourceFile(root,item.path)));
    if(digest!==item.sha256)fail('source_changed');
    files.push({path:item.path,sha256:digest});
    aggregate.update(JSON.stringify([item.path,digest])+'\n');
  }
  if(aggregate.digest('hex')!==source.sha256)fail('source_changed');
  return {head:source.head,tree:source.tree,dirty:false,sha256:source.sha256,files};
}

/** Host-only export: a clean Git checkout vouches for the manifest before Docker COPY. */
export async function preparePortableSource(root){
  root=path.resolve(root);
  const gitEntry=lstatSync(path.join(root,'.git'),{throwIfNoEntry:false});
  if(!gitEntry||gitEntry.isSymbolicLink()||!(gitEntry.isDirectory()||gitEntry.isFile()))fail('git_required');
  const source=sourceIdentity(root);
  if(source.dirty||!SHA40.test(source.head??'')||!SHA40.test(source.tree??'')||
    !SHA64.test(source.sha256??'')||source.files.some(item=>item.sha256===null))fail('dirty_source');
  const names=source.files.map(item=>item.path);
  if(names.some(name=>!safeName(name)||name.split('/').some(skip))||
    names.some((name,index)=>index>0&&names[index-1]>=name))fail('invalid_source');
  const archive=spawnSync('git',['archive','--format=tar','HEAD'],{cwd:root,
    encoding:'buffer',windowsHide:true,timeout:120000,maxBuffer:256*1024*1024});
  if(archive.status!==0||!archive.stdout)fail('git_archive');
  const record={schemaVersion:1,source:{head:source.head,tree:source.tree,dirty:false,
    sha256:source.sha256,archiveDigest:hash(archive.stdout),files:source.files}};
  const directory=path.join(root,'.creezio');
  const existing=lstatSync(directory,{throwIfNoEntry:false});
  if(existing&&(!existing.isDirectory()||existing.isSymbolicLink()))fail('manifest_path');
  mkdirSync(directory,{recursive:true});
  const target=sourcePath(root),current=lstatSync(target,{throwIfNoEntry:false});
  if(current&&(!current.isFile()||current.isSymbolicLink()))fail('manifest_path');
  const bytes=Buffer.from(JSON.stringify(record)+'\n');
  if(bytes.length>LIMIT)fail('manifest_limit');
  if(current&&readFileSync(target).equals(bytes))return record;
  const temporary=`${target}.tmp-${process.pid}`;
  if(existsSync(temporary))fail('temporary_exists');
  try{writeFileSync(temporary,bytes,{flag:'wx'});renameSync(temporary,target);}
  finally{if(existsSync(temporary))unlinkSync(temporary);}
  return record;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [mode,...extra]=process.argv.slice(2);
  if(!['prepare','verify'].includes(mode)||extra.length){
    console.error('Usage: node scripts/local/source-manifest.mjs prepare|verify');process.exitCode=2;
  }else try{
    const root=fileURLToPath(new URL('../../',import.meta.url));
    const source=mode==='prepare'?(await preparePortableSource(root)).source:verifyPortableSource(root);
    console.log(JSON.stringify({mode,head:source.head,tree:source.tree,sha256:source.sha256,
      fileCount:source.files.length}));
  }catch(error){console.error(error?.code?`source_manifest_${error.code}`:'source_manifest_unavailable');process.exitCode=1;}
}
