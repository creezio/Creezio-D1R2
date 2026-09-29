#!/usr/bin/env node
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {copyFileSync,existsSync,lstatSync,mkdirSync,readFileSync,realpathSync,unlinkSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {sourceIdentity,sameSourceIdentity} from '../quality/evidence.mjs';
import {inspectSitesMetadata} from './artifacts.mjs';
import {planSitesExport} from './export.mjs';

const here=fileURLToPath(new URL('../../',import.meta.url));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const canonical=value=>JSON.stringify(value);
const rootKey=value=>{
  const absolute=realpathSync.native(value);
  return process.platform==='win32'?absolute.toLowerCase():absolute;
};
const relativePath=value=>typeof value==='string'&&!!value&&!path.isAbsolute(value)&&
  !value.includes('\\')&&value.split('/').every(part=>!!part&&part!=='.'&&part!=='..'&&
    !/[\x00-\x1f\x7f:*?"<>|]/.test(part)&&!/[. ]$/.test(part)&&
    !/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(part));

function safe(root,relative,{missing=false,directory=false}={}){
  if(!path.isAbsolute(root)||!relativePath(relative))throw new Error('Unsafe Sites source path.');
  const base=path.resolve(root),full=path.resolve(base,...relative.split('/'));
  if(!full.startsWith(base+path.sep))throw new Error('Sites source path leaves its root.');
  for(let cursor=full;;cursor=path.dirname(cursor)){
    const stat=lstatSync(cursor,{throwIfNoEntry:false});
    if(stat?.isSymbolicLink()||stat&&cursor!==full&&!stat.isDirectory()||
      stat&&cursor===full&&(directory?!stat.isDirectory():!stat.isFile()))
      throw new Error('Linked or non-regular Sites source path.');
    if(cursor===path.dirname(cursor))break;
  }
  if(!missing&&!existsSync(full))throw new Error('Sites source path is missing.');
  return full;
}
function rootDirectory(root){
  if(!path.isAbsolute(root)||!lstatSync(root).isDirectory()||lstatSync(root).isSymbolicLink())
    throw new Error('Selected Sites source directory is invalid.');
  for(let cursor=path.resolve(root);;cursor=path.dirname(cursor)){
    if(lstatSync(cursor).isSymbolicLink())throw new Error('Linked Sites source directory.');
    if(cursor===path.dirname(cursor))break;
  }
  return path.resolve(root);
}
function externalFile(file,{missing=false}={}){
  if(!path.isAbsolute(file))throw new Error('Sites source evidence requires an absolute path.');
  const full=path.resolve(file),parent=rootDirectory(path.dirname(full));
  if(full===parent)throw new Error('Invalid Sites source evidence path.');
  const stat=lstatSync(full,{throwIfNoEntry:false});
  if(stat?.isSymbolicLink()||stat&&!stat.isFile()||!missing&&!stat)
    throw new Error('Invalid Sites source evidence file.');
  return full;
}
function boundedJson(file,max=4*1024*1024){
  const name=externalFile(file),stat=lstatSync(name);
  if(stat.size>max)throw new Error('Sites source evidence exceeds its bound.');
  return JSON.parse(readFileSync(name,'utf8'));
}
function git(root,...args){
  return execFileSync('git',['-C',root,...args],{encoding:'utf8',windowsHide:true,
    stdio:['ignore','pipe','pipe']}).trim();
}
function tracked(root){
  return git(root,'ls-files','--cached','-z').split('\0').filter(Boolean).sort();
}
function measured(root,relative){
  const bytes=readFileSync(safe(root,relative));
  return {path:relative,bytes:bytes.length,sha256:sha(bytes)};
}
function selection(source,site,projectId,compositionDigest){
  const metadata=inspectSitesMetadata(site,{projectId,compositionDigest});
  const sourceFiles=source.files.filter(file=>file.sha256!==null&&file.path!=='.openai/hosting.json');
  if(sourceFiles.some(file=>!relativePath(file.path)||
    /^(?:db|drizzle|private|node_modules|dist|\.creezio|\.quality|\.openai)(?:\/|$)/.test(file.path)||
    file.path==='sites-source-provenance.json'||
    /\.(?:clixml|pem|key|sqlite|db)$/.test(file.path)))
    throw new Error('Core source includes a disallowed Sites file.');
  if(!sourceFiles.some(file=>file.path==='package.json')||
    !sourceFiles.some(file=>file.path==='scripts/sites/build.mjs')||
    !sourceFiles.some(file=>file.path==='configuration/composition.sites.json')||
    !sourceFiles.some(file=>file.path==='configuration/composition.sites.lock.json'))
    throw new Error('Core source lacks the Sites build profile.');
  const build=boundedJson(safe(source.root,'.quality/sites-build.json'));
  if(build.projectId!==projectId||build.compositionDigest!==compositionDigest||
    !sameSourceIdentity(source,build.source)||build.metadata?.digest!==metadata.digest)
    throw new Error('Sites build receipt differs from its source or target.');
  const generated=['db/schema.ts','db/creezio-schema-history.json','drizzle.config.cjs',
    ...metadata.files.filter(file=>file.source!=='.openai/hosting.json').map(file=>file.source)];
  if(existsSync(safe(site,'db/provider-schema.json',{missing:true})))generated.push('db/provider-schema.json');
  const selected=new Map();
  for(const file of sourceFiles){
    const current=measured(source.root,file.path);
    if(current.sha256!==file.sha256)throw new Error('Core source changed after Git inventory.');
    selected.set(file.path,{...current,from:'core'});
  }
  for(const relative of generated){
    if(selected.has(relative))throw new Error('Generated Sites file collides with Core source.');
    selected.set(relative,{...measured(site,relative),from:'target'});
  }
  selected.set('.openai/hosting.json',{...measured(site,'.openai/hosting.json'),from:'target'});
  const pkg=JSON.parse(readFileSync(safe(source.root,'package.json'),'utf8'));
  if(!pkg||typeof pkg!=='object'||!pkg.scripts||typeof pkg.scripts!=='object')
    throw new Error('Core package lacks build scripts.');
  pkg.scripts.build='node --eval "process.env.CREEZIO_COMPOSITION=\'configuration/composition.sites.json\';'
    +'process.env.CREEZIO_COMPOSITION_LOCK=\'configuration/composition.sites.lock.json\';'
    +'import(\'./scripts/sites/build.mjs\')"';
  const packageBytes=Buffer.from(JSON.stringify(pkg,null,2)+'\n');
  selected.set('package.json',{path:'package.json',bytes:packageBytes.length,
    sha256:sha(packageBytes),from:'transformed'});
  return {metadata,files:[...selected.values()].sort((a,b)=>a.path.localeCompare(b.path)),packageBytes};
}
function prior(stage,projectId){
  const name=safe(stage,'sites-source-provenance.json',{missing:true});
  if(!existsSync(name))return null;
  const value=boundedJson(name,1024*1024);
  if(value.schemaVersion!==1||value.projectId!==projectId)
    throw new Error('Previous Sites source provenance is invalid.');
  // The two existing Sites use the reviewed T56 provenance shape. Accept its
  // measured source/generated inventory, but never infer ownership from Git age.
  const oldShape=!Array.isArray(value.files)&&Array.isArray(value.sourceFiles)&&
    Array.isArray(value.generated)&&/^[a-f0-9]{64}$/.test(value.packageDigest);
  const files=oldShape?[...value.sourceFiles.filter(file=>file.path!=='package.json'),
    ...value.generated,{path:'package.json',sha256:value.packageDigest}]:value.files;
  if(!Array.isArray(files)||files.length>4096||!files.length)
    throw new Error('Previous Sites source inventory is invalid.');
  const names=new Set();
  for(const file of files){
    if(!relativePath(file?.path)||names.has(file.path)||
      !/^[a-f0-9]{64}$/.test(file.sha256)||
      !oldShape&&(!Number.isSafeInteger(file.bytes)||file.bytes<0))
      throw new Error('Previous Sites source inventory is invalid.');
    names.add(file.path);
    const current=measured(stage,file.path);
    if(current.sha256!==file.sha256||!oldShape&&current.bytes!==file.bytes)
      throw new Error('Previous Sites source differs from its provenance.');
  }
  return {...value,files};
}
function planned({applicationRoot=here,siteRoot,stageRoot}){
  const core=rootDirectory(applicationRoot),site=rootDirectory(siteRoot),stage=rootDirectory(stageRoot);
  const roots=[core,site,stage].map(rootKey);
  if(roots.some((root,index)=>roots.some((other,otherIndex)=>otherIndex!==index&&
    (root===other||root.startsWith(other+path.sep)))))
    throw new Error('Sites source roots must be disjoint.');
  const source={...sourceIdentity(core),root:core},stageSource=sourceIdentity(stage);
  if(source.dirty||stageSource.dirty)throw new Error('Core and Sites staging must be clean Git sources.');
  const exportPlan=planSitesExport('app',site,{applicationRoot:core});
  const {metadata,files}=selection(source,site,exportPlan.projectId,
    boundedJson(safe(core,'.quality/sites-build.json')).compositionDigest);
  if(metadata.digest!==exportPlan.metadataDigest)throw new Error('Sites metadata differs from built archive plan.');
  if(files.length>4096)throw new Error('Sites source inventory exceeds its bound.');
  const previous=prior(stage,exportPlan.projectId);
  const previousNames=new Set(previous?.files.map(file=>file.path)??[]);
  const desired=new Map(files.map(file=>[file.path,file]));
  if(new Set(files.map(file=>file.path.toLowerCase())).size!==files.length)
    throw new Error('Sites source contains case-colliding paths.');
  const present=tracked(stage),removed=[];
  for(const name of present){
    if(!relativePath(name))throw new Error('Unsafe tracked Sites staging path.');
    if(name==='sites-source-provenance.json'||name==='.openai/hosting.json')continue;
    if(!desired.has(name)){
      if(!previousNames.has(name))throw new Error('Unknown tracked Sites staging file.');
      removed.push(name);
    }else if(!previousNames.has(name)){
      const actual=measured(stage,name),expected=desired.get(name);
      if(actual.sha256!==expected.sha256||actual.bytes!==expected.bytes)
        throw new Error('Existing Sites staging file has unknown provenance.');
    }
  }
  for(const name of previousNames)if(!present.includes(name))
    throw new Error('Previous Sites source inventory is no longer tracked.');
  if(!present.includes('.openai/hosting.json')||
    measured(stage,'.openai/hosting.json').sha256!==desired.get('.openai/hosting.json').sha256)
    throw new Error('Sites staging belongs to another project or hosting manifest.');
  if(previous&&!present.includes('sites-source-provenance.json'))
    throw new Error('Previous Sites provenance is not tracked.');
  for(const file of files){
    const target=safe(stage,file.path,{missing:true});
    if(existsSync(target)&&!present.includes(file.path))
      throw new Error('Existing untracked Sites staging file is not owned by this plan.');
  }
  for(const name of removed)safe(stage,name);
  const identity={head:source.head,tree:source.tree,sha256:source.sha256};
  const stageIdentity={head:stageSource.head,tree:stageSource.tree,sha256:stageSource.sha256};
  return {schemaVersion:1,projectId:exportPlan.projectId,core,site,stage,
    coreSource:identity,stageBase:stageIdentity,
    compositionDigest:metadata.compositionDigest,metadataDigest:metadata.digest,
    artifactDigest:exportPlan.artifactDigest,files,removed:removed.sort(),
    previousProvenanceSha256:previous?sha(readFileSync(safe(stage,'sites-source-provenance.json'))):null};
}
/** Read-only planning; the caller persists the plan before any staging mutation. */
export function planSitesSource(options){return planned(options);}
function verifyPlan(plan){
  const current=planned({applicationRoot:plan.core,siteRoot:plan.site,stageRoot:plan.stage});
  if(canonical(current)!==canonical(plan))throw new Error('Sites source changed since its durable plan.');
}
function evidenceOutside(plan,file){
  const result=externalFile(file,{missing:true});
  const chosen=process.platform==='win32'?result.toLowerCase():result;
  if([plan.core,plan.site,plan.stage].some(root=>{
    const key=rootKey(root);
    return chosen===key||chosen.startsWith(key+path.sep);
  }))
    throw new Error('Sites source receipt must be outside all source roots.');
  return result;
}
/** The plan is durable first. An interrupted copy leaves a dirty Git stage and cannot auto-replay. */
export function prepareSitesSource(plan,planFile,receiptFile){
  const planPath=evidenceOutside(plan,planFile),receiptPath=evidenceOutside(plan,receiptFile);
  if(planPath===receiptPath||existsSync(receiptPath))throw new Error('Sites source receipt already exists.');
  if(canonical(boundedJson(planPath))!==canonical(plan))throw new Error('Durable Sites source plan differs.');
  verifyPlan(plan);
  const files=plan.files.filter(file=>file.path!=='.openai/hosting.json');
  const packageBytes=selection({...sourceIdentity(plan.core),root:plan.core},plan.site,
    plan.projectId,plan.compositionDigest).packageBytes;
  for(const file of files){
    const from=file.from==='core'?plan.core:plan.site;
    if(file.from==='transformed')continue;
    const current=measured(from,file.path);
    if(current.sha256!==file.sha256||current.bytes!==file.bytes)
      throw new Error('Sites source bytes changed before staging.');
  }
  for(const relative of plan.removed)unlinkSync(safe(plan.stage,relative));
  for(const file of files){
    let target=safe(plan.stage,file.path,{missing:true});
    mkdirSync(path.dirname(target),{recursive:true});
    target=safe(plan.stage,file.path,{missing:true});
    if(file.from==='transformed')writeFileSync(target,packageBytes);
    else copyFileSync(safe(file.from==='core'?plan.core:plan.site,file.path),target);
    const actual=measured(plan.stage,file.path);
    if(actual.sha256!==file.sha256||actual.bytes!==file.bytes)
      throw new Error('Staged Sites source differs from its durable plan.');
  }
  const provenance={schemaVersion:1,projectId:plan.projectId,coreSource:plan.coreSource,
    stageBase:plan.stageBase,compositionDigest:plan.compositionDigest,
    metadataDigest:plan.metadataDigest,artifactDigest:plan.artifactDigest,
    files:plan.files.map(({path,bytes,sha256})=>({path,bytes,sha256}))};
  writeFileSync(safe(plan.stage,'sites-source-provenance.json',{missing:true}),
    JSON.stringify(provenance,null,2)+'\n');
  const proof={schemaVersion:1,planSha256:sha(readFileSync(planPath)),projectId:plan.projectId,
    coreSource:plan.coreSource,stageBase:plan.stageBase,compositionDigest:plan.compositionDigest,
    metadataDigest:plan.metadataDigest,artifactDigest:plan.artifactDigest,
    provenanceSha256:sha(readFileSync(safe(plan.stage,'sites-source-provenance.json'))),
    files:provenance.files,removed:plan.removed};
  writeFileSync(receiptPath,JSON.stringify(proof,null,2)+'\n',{flag:'wx'});
  return proof;
}
/** Verify the manually committed staging source; never commit or publish from this helper. */
export function verifySitesSource(planFile,receiptFile){
  const plan=boundedJson(planFile),proof=boundedJson(receiptFile);
  if(plan.schemaVersion!==1||proof.schemaVersion!==1||
    proof.planSha256!==sha(readFileSync(externalFile(planFile))))
    throw new Error('Sites source receipt is unrelated to its plan.');
  if(proof.projectId!==plan.projectId||canonical(proof.coreSource)!==canonical(plan.coreSource)||
    canonical(proof.stageBase)!==canonical(plan.stageBase)||
    proof.compositionDigest!==plan.compositionDigest||proof.metadataDigest!==plan.metadataDigest||
    proof.artifactDigest!==plan.artifactDigest||canonical(proof.files)!==canonical(
      plan.files.map(({path,bytes,sha256})=>({path,bytes,sha256})))||
    canonical(proof.removed)!==canonical(plan.removed))
    throw new Error('Sites source receipt differs from its durable plan.');
  const stage=rootDirectory(plan.stage),identity=sourceIdentity(stage);
  try{git(stage,'merge-base','--is-ancestor',plan.stageBase.head,identity.head);}
  catch{throw new Error('Committed Sites source does not descend from the planned staging base.');}
  if(identity.dirty||identity.head===plan.stageBase.head||
    sourceIdentity(plan.core).dirty||!sameSourceIdentity(sourceIdentity(plan.core),plan.coreSource))
    throw new Error('Sites staging or Core source has not been committed as planned.');
  const provenance=boundedJson(safe(stage,'sites-source-provenance.json'),1024*1024);
  if(sha(readFileSync(safe(stage,'sites-source-provenance.json')))!==proof.provenanceSha256||
    provenance.projectId!==plan.projectId||canonical(provenance.files)!==canonical(proof.files)||
    canonical(provenance.coreSource)!==canonical(plan.coreSource))
    throw new Error('Sites staging provenance differs from its preparation receipt.');
  const expected=[...proof.files.map(file=>file.path),'sites-source-provenance.json'].sort();
  if(canonical(tracked(stage))!==canonical(expected))
    throw new Error('Committed Sites source includes missing or unknown tracked files.');
  for(const file of proof.files){
    const current=measured(stage,file.path);
    if(current.sha256!==file.sha256||current.bytes!==file.bytes)
      throw new Error('Committed Sites source differs from its preparation receipt.');
  }
  return {schemaVersion:1,projectId:plan.projectId,coreSource:plan.coreSource,
    siteSource:{head:identity.head,tree:identity.tree,sha256:identity.sha256},
    planSha256:proof.planSha256,provenanceSha256:proof.provenanceSha256,
    compositionDigest:plan.compositionDigest,metadataDigest:plan.metadataDigest,
    artifactDigest:plan.artifactDigest,files:proof.files.length};
}
function args(argv){
  const mode=argv.shift(),result={};
  if(argv.length%2||!['plan','prepare','verify'].includes(mode))
    throw new Error('Use plan|prepare|verify with absolute Sites source and evidence paths.');
  for(let i=0;i<argv.length;i+=2){
    const key=argv[i],value=argv[i+1];
    if(!['--core','--site','--stage','--plan','--receipt','--verification'].includes(key)||
      result[key]||!path.isAbsolute(value))
      throw new Error('Invalid Sites source argument.');
    result[key]=value;
  }
  if(mode==='plan'&&(!result['--site']||!result['--stage']||!result['--plan'])||
    mode==='prepare'&&(!result['--plan']||!result['--receipt'])||
    mode==='verify'&&(!result['--plan']||!result['--receipt']||!result['--verification']))
    throw new Error('Missing Sites source argument.');
  if(Object.keys(result).some(key=>!({plan:['--core','--site','--stage','--plan'],
    prepare:['--plan','--receipt'],verify:['--plan','--receipt','--verification']}[mode].includes(key))))
    throw new Error('Unexpected Sites source argument.');
  return {mode,result};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const {mode,result}=args(process.argv.slice(2));
  if(mode==='plan'){
    const plan=planSitesSource({applicationRoot:result['--core']??here,
      siteRoot:result['--site'],stageRoot:result['--stage']});
    const file=evidenceOutside(plan,result['--plan']);
    writeFileSync(file,JSON.stringify(plan,null,2)+'\n',{flag:'wx'});
    console.log(JSON.stringify({mode,projectId:plan.projectId,coreHead:plan.coreSource.head,
      stageBase:plan.stageBase.head,files:plan.files.length,removed:plan.removed.length}));
  }else{
    const plan=boundedJson(result['--plan']);
    const value=mode==='prepare'?prepareSitesSource(plan,result['--plan'],result['--receipt']):
      verifySitesSource(result['--plan'],result['--receipt']);
    if(mode==='verify')writeFileSync(evidenceOutside(plan,result['--verification']),
      JSON.stringify(value,null,2)+'\n',{flag:'wx'});
    console.log(JSON.stringify({mode,projectId:value.projectId,
      coreHead:value.coreSource.head,...(mode==='verify'?{siteHead:value.siteSource.head}:{}),
      files:value.files.length??value.files}));
  }
}
