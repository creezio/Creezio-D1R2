#!/usr/bin/env node
import {createHash,randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {closeSync,existsSync,lstatSync,openSync,readFileSync,statSync,unlinkSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {gzipSync} from 'node:zlib';
import {sourceIdentity,sameSourceIdentity} from '../quality/evidence.mjs';
import {measureRuntimeArtifacts} from '../quality/runtime.mjs';
import {verifySitesArtifactTree,verifySitesMetadata} from './artifacts.mjs';

const here=fileURLToPath(new URL('../../',import.meta.url));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function json(file,max=1024*1024){
  const stat=lstatSync(file);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>max)throw new Error('Invalid Sites export receipt.');
  return JSON.parse(readFileSync(file,'utf8'));
}
function regular(root,relative){
  if(typeof relative!=='string'||!relative||path.isAbsolute(relative)||relative.includes('\\')||
    relative.split('/').some(part=>!part||part==='.'||part==='..'||/[\r\n\0]/.test(part)))
    throw new Error('Unsafe Sites export path.');
  const base=path.resolve(root),full=path.resolve(base,...relative.split('/'));
  if(!full.startsWith(base+path.sep))throw new Error('Sites export leaves its root.');
  for(let cursor=full;;cursor=path.dirname(cursor)){
    const stat=lstatSync(cursor,{throwIfNoEntry:false});
    if(stat?.isSymbolicLink()||stat&&cursor!==full&&!stat.isDirectory())
      throw new Error('Linked Sites export path.');
    if(cursor===path.dirname(cursor))break;
  }
  if(!lstatSync(full).isFile())throw new Error('Sites export file is missing.');
  return full;
}
function argPairs(argv){
  const result={};
  if(argv.length%2)throw new Error('Use --kind app|operator --site DIRECTORY --archive FILE --receipt FILE.');
  for(let index=0;index<argv.length;index+=2){
    const name=argv[index],value=argv[index+1];
    if(!['--kind','--site','--archive','--receipt'].includes(name)||result[name]||!value)
      throw new Error('Invalid Sites export argument.');
    result[name]=value;
  }
  if(!['app','operator'].includes(result['--kind'])||!path.isAbsolute(result['--site'])||
    !path.isAbsolute(result['--archive'])||!path.isAbsolute(result['--receipt'])||
    result['--archive']===result['--receipt'])throw new Error('Sites export requires exact absolute paths.');
  return result;
}
function planApp(siteRoot,applicationRoot){
  const source=sourceIdentity(applicationRoot);
  if(source.dirty)throw new Error('Sites application source must be committed before export.');
  const build=json(path.join(applicationRoot,'.quality/sites-build.json'),4*1024*1024);
  const metadata=verifySitesMetadata(siteRoot,applicationRoot,{projectId:build.projectId,
    compositionDigest:build.compositionDigest});
  const artifact=measureRuntimeArtifacts(applicationRoot);
  verifySitesArtifactTree(applicationRoot,
    [...artifact.files.map(file=>file.path),...metadata.files.map(file=>file.artifact)]);
  if(!sameSourceIdentity(source,build.source)||artifact.digest!==build.artifact?.digest||
    metadata.digest!==build.metadata?.digest||
    JSON.stringify(metadata.files)!==JSON.stringify(build.metadata?.files))
    throw new Error('Sites application build or metadata differs from its source receipt.');
  const files=[...artifact.files.map(item=>({path:item.path,bytes:item.bytes,sha256:item.sha256})),
    ...metadata.files.map(item=>({path:item.artifact,bytes:item.bytes,sha256:item.digest.slice(7)}))];
  return {projectId:metadata.projectId,source:{head:source.head,tree:source.tree,sha256:source.sha256},
    artifactDigest:artifact.digest,metadataDigest:metadata.digest,
    groups:[{root:applicationRoot,files}]};
}
function planOperator(siteRoot){
  const source=sourceIdentity(siteRoot);
  if(source.dirty)throw new Error('Sites operator source must be committed before export.');
  const provenance=json(regular(siteRoot,'operator-provenance.json'));
  const metadata=verifySitesMetadata(siteRoot,siteRoot,{projectId:provenance.projectId,
    applicationId:provenance.applicationId,compositionDigest:provenance.compositionDigest});
  const code=regular(siteRoot,'operator.mjs'),index=regular(siteRoot,'dist/server/index.js');
  verifySitesArtifactTree(siteRoot,['dist/server/index.js',...metadata.files.map(file=>file.artifact)]);
  if(`sha256-${hash(readFileSync(code))}`!==provenance.operatorDigest||
    hash(readFileSync(code))!==hash(readFileSync(index)))
    throw new Error('Sites operator build differs from its provenance.');
  const files=[{path:'dist/server/index.js',bytes:statSync(index).size,sha256:hash(readFileSync(index))},
    ...metadata.files.map(item=>({path:item.artifact,bytes:item.bytes,sha256:item.digest.slice(7)}))];
  return {projectId:metadata.projectId,source:{head:source.head,tree:source.tree,
    sha256:source.sha256,operatorDigest:provenance.operatorDigest,
    compositionDigest:provenance.compositionDigest,planDigest:provenance.planDigest},
    artifactDigest:provenance.operatorDigest,metadataDigest:metadata.digest,
    groups:[{root:siteRoot,files}]};
}
/** Read-only plan before tar; no source or build tree is copied. */
export function planSitesExport(kind,siteRoot,{applicationRoot=here}={}){
  if(!path.isAbsolute(siteRoot)||!lstatSync(siteRoot).isDirectory()||lstatSync(siteRoot).isSymbolicLink())
    throw new Error('Selected Sites directory is invalid.');
  const plan=kind==='app'?planApp(siteRoot,applicationRoot):kind==='operator'?planOperator(siteRoot):null;
  if(!plan)throw new Error('Sites export kind is invalid.');
  const names=new Set();
  for(const group of plan.groups)for(const file of group.files){
    const relative=file.path;
    if(names.has(relative))throw new Error('Duplicate Sites archive path.');
    names.add(relative);regular(group.root,relative);
  }
  return {...plan,kind,siteRoot,applicationRoot};
}
function verifyPlan(plan){
  const current=planSitesExport(plan.kind,plan.siteRoot,{applicationRoot:plan.applicationRoot});
  if(JSON.stringify(current)!==JSON.stringify(plan))
    throw new Error('Sites source or artifact changed during archive creation.');
}
export function writeSitesArchive(plan,archive,receipt){
  const target=path.resolve(archive),proof=path.resolve(receipt);
  if(target===proof||existsSync(target)||existsSync(proof))throw new Error('Sites archive or receipt already exists.');
  for(const output of [target,proof])if(!lstatSync(path.dirname(output)).isDirectory()||
    lstatSync(path.dirname(output)).isSymbolicLink())throw new Error('Unsafe Sites output directory.');
  if(plan.groups.some(group=>target.startsWith(path.resolve(group.root)+path.sep)||
    proof.startsWith(path.resolve(group.root)+path.sep)))
    throw new Error('Sites archive and receipt must be outside source directories.');
  const lists=[],suffix=randomBytes(6).toString('hex'),tarPath=proof+`.tar-${suffix}`;
  let tarFd;
  try{
    verifyPlan(plan);
    for(const [index,group] of plan.groups.entries()){
      const list=proof+`.list-${suffix}-${index}`;
      writeFileSync(list,group.files.map(file=>file.path).join('\n')+'\n',{flag:'wx',mode:0o600});
      lists.push(list);
    }
    tarFd=openSync(tarPath,'wx',0o600);
    const first=plan.groups[0],created=spawnSync('tar',['-cf','-','-C',first.root,'-T',lists[0]],
      {stdio:['ignore',tarFd,'pipe'],windowsHide:true,timeout:120_000});
    closeSync(tarFd);tarFd=undefined;
    if(created.error||created.status!==0)throw new Error('Sites tar creation failed.');
    for(let index=1;index<plan.groups.length;index++){
      const group=plan.groups[index];
      const appended=spawnSync('tar',['-rf',tarPath,'-C',group.root,'-T',lists[index]],
        {stdio:['ignore','pipe','pipe'],windowsHide:true,timeout:120_000});
      if(appended.error||appended.status!==0)throw new Error('Sites tar append failed.');
    }
    if(statSync(tarPath).size>64*1024*1024)throw new Error('Sites tar exceeds the bounded export size.');
    writeFileSync(target,gzipSync(readFileSync(tarPath)),{flag:'wx',mode:0o600});
    const listed=spawnSync('tar',['-tzf',target],{encoding:'utf8',windowsHide:true,timeout:30_000,
      maxBuffer:4*1024*1024});
    const expected=plan.groups.flatMap(group=>group.files.map(file=>file.path));
    if(listed.error||listed.status!==0||JSON.stringify(listed.stdout.trimEnd().split(/\r?\n/))!==JSON.stringify(expected))
      throw new Error('Sites tar inventory differs; preserve the archive for inspection.');
    for(const file of plan.groups.flatMap(group=>group.files)){
      const extracted=spawnSync('tar',['-xOzf',target,file.path],
        {windowsHide:true,timeout:30_000,maxBuffer:65*1024*1024});
      if(extracted.error||extracted.status!==0||extracted.stdout.length!==file.bytes||
        hash(extracted.stdout)!==file.sha256)
        throw new Error('Sites tar member differs from the measured artifact; preserve the archive for inspection.');
    }
    verifyPlan(plan);
    const evidence={schemaVersion:1,projectId:plan.projectId,source:plan.source,
      artifactDigest:plan.artifactDigest,metadataDigest:plan.metadataDigest,
      archive:{sha256:`sha256-${hash(readFileSync(target))}`,bytes:statSync(target).size,
        files:plan.groups.flatMap(group=>group.files)}};
    writeFileSync(proof,JSON.stringify(evidence,null,2)+'\n',{flag:'wx',mode:0o600});
    return evidence;
  }finally{
    if(tarFd!==undefined)closeSync(tarFd);
    if(existsSync(tarPath))unlinkSync(tarPath);
    for(const list of lists)unlinkSync(list);
  }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=argPairs(process.argv.slice(2));
  const plan=planSitesExport(args['--kind'],args['--site']);
  const receipt=writeSitesArchive(plan,args['--archive'],args['--receipt']);
  console.log(JSON.stringify({projectId:receipt.projectId,archive:args['--archive'],
    sha256:receipt.archive.sha256,files:receipt.archive.files.length}));
}
