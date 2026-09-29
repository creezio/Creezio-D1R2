import {createHash} from 'node:crypto';
import {copyFileSync,lstatSync,mkdirSync,readFileSync,readdirSync} from 'node:fs';
import path from 'node:path';

const digest=bytes=>`sha256-${createHash('sha256').update(bytes).digest('hex')}`;
const migrationPath=/^drizzle\/[A-Za-z0-9_-]+\.sql$/;
const snapshotPath=/^drizzle\/meta\/[A-Za-z0-9_-]+_snapshot\.json$/;
const journalPath='drizzle/meta/_journal.json';

function regular(root,relative,kind='file'){
  if(typeof root!=='string'||!path.isAbsolute(root)||typeof relative!=='string'||
    !relative||relative.includes('\\')||path.isAbsolute(relative)||
    relative.split('/').some(part=>!part||part==='.'||part==='..'))
    throw new Error('Unsafe Sites artifact path.');
  const base=path.resolve(root),full=path.resolve(base,...relative.split('/'));
  if(!full.startsWith(base+path.sep))throw new Error('Sites artifact leaves its root.');
  for(let cursor=full;;cursor=path.dirname(cursor)){
    const stat=lstatSync(cursor,{throwIfNoEntry:false});
    if(stat?.isSymbolicLink()||stat&&cursor!==full&&!stat.isDirectory())
      throw new Error('Linked or non-regular Sites artifact path.');
    if(cursor===full&&stat&&(kind==='file'?!stat.isFile():!stat.isDirectory()))
      throw new Error('Non-regular Sites artifact.');
    if(cursor===path.dirname(cursor))break;
  }
  return full;
}
function boundedJson(file,maxBytes){
  const stat=lstatSync(file);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>maxBytes)throw new Error('Sites metadata JSON is invalid.');
  return JSON.parse(readFileSync(file,'utf8'));
}
function tree(root,relative){
  const folder=regular(root,relative,'directory');
  return readdirSync(folder,{withFileTypes:true}).flatMap(entry=>{
    const child=`${relative}/${entry.name}`,stat=lstatSync(path.join(folder,entry.name));
    if(stat.isSymbolicLink()||!stat.isDirectory()&&!stat.isFile())
      throw new Error('Linked or non-regular Sites artifact.');
    return stat.isDirectory()?tree(root,child):[child];
  });
}

/** The central Drizzle history is the sole migration inventory. It may contain many generations. */
export function inspectSitesMetadata(sourceRoot,{applicationId,compositionDigest,projectId}={}){
  const hosting=boundedJson(regular(sourceRoot,'.openai/hosting.json'),4096);
  if(Object.keys(hosting).sort().join(',')!=='d1,project_id,r2'||hosting.d1!=='DB'||hosting.r2!=='BUCKET'||
    typeof hosting.project_id!=='string'||!hosting.project_id||
    projectId!==undefined&&hosting.project_id!==projectId)
    throw new Error('Sites hosting metadata differs from the selected project.');
  const history=boundedJson(regular(sourceRoot,'db/creezio-schema-history.json'),1024*1024);
  if(history.schemaVersion!==1||typeof history.applicationId!=='string'||!history.applicationId||
    applicationId!==undefined&&history.applicationId!==applicationId||
    compositionDigest!==undefined&&history.compositionDigest!==compositionDigest||
    !Array.isArray(history.files)||history.files.length<3||history.files.length>1024)
    throw new Error('Sites schema history differs from the selected composition.');
  const paths=new Set(),files=[{source:'.openai/hosting.json',artifact:'dist/.openai/hosting.json'}];
  let migrations=0,snapshots=0,journals=0;
  for(const entry of history.files){
    const relative=entry?.path;
    if(typeof relative!=='string'||!(migrationPath.test(relative)||snapshotPath.test(relative)||
      relative===journalPath)||paths.has(relative)||!/^sha256-[a-f0-9]{64}$/.test(entry.digest))
      throw new Error('Unsafe or duplicate Sites migration inventory.');
    paths.add(relative);
    if(migrationPath.test(relative))migrations++;
    else if(snapshotPath.test(relative))snapshots++;
    else journals++;
    const bytes=readFileSync(regular(sourceRoot,relative));
    if(digest(bytes)!==entry.digest)throw new Error('Generated Sites migration differs from central history.');
    files.push({source:relative,artifact:`dist/.openai/${relative}`});
  }
  if(migrations<1||snapshots!==migrations||journals!==1)
    throw new Error('Incomplete Sites migration inventory.');
  if(JSON.stringify(tree(sourceRoot,'drizzle').sort())!==JSON.stringify([...paths].sort()))
    throw new Error('Sites migration tree differs from central history.');
  const measured=files.map(file=>{
    const bytes=readFileSync(regular(sourceRoot,file.source));
    return {...file,bytes:bytes.length,digest:digest(bytes)};
  });
  return {projectId:hosting.project_id,applicationId:history.applicationId,
    compositionDigest:history.compositionDigest,
    digest:digest(Buffer.from(JSON.stringify(measured))),
    files:measured};
}

export function verifySitesMetadata(sourceRoot,artifactRoot,expected={}){
  const metadata=inspectSitesMetadata(sourceRoot,expected);
  const actual=tree(artifactRoot,'dist/.openai').sort();
  const selected=metadata.files.map(file=>file.artifact).sort();
  if(JSON.stringify(actual)!==JSON.stringify(selected))
    throw new Error('Sites dist metadata contains missing or unexpected files.');
  for(const file of metadata.files)
    if(digest(readFileSync(regular(artifactRoot,file.artifact)))!==file.digest)
      throw new Error('Sites dist metadata differs from its source.');
  return metadata;
}

export function stageSitesMetadata(sourceRoot,artifactRoot,expected={}){
  const metadata=inspectSitesMetadata(sourceRoot,expected);
  for(const file of metadata.files){
    const destination=regular(artifactRoot,file.artifact);
    mkdirSync(path.dirname(destination),{recursive:true});
    copyFileSync(regular(sourceRoot,file.source),destination);
  }
  return verifySitesMetadata(sourceRoot,artifactRoot,expected);
}

export function verifySitesArtifactTree(artifactRoot,files){
  if(!Array.isArray(files)||!files.length||files.some(file=>typeof file!=='string'||
    !file.startsWith('dist/'))||new Set(files).size!==files.length)
    throw new Error('Invalid Sites dist inventory.');
  const actual=tree(artifactRoot,'dist').sort(),selected=[...files].sort();
  if(JSON.stringify(actual)!==JSON.stringify(selected))
    throw new Error('Sites dist contains unexpected or missing files.');
}

/** Copied byte-for-byte into each standalone operator descriptor by prepare-operator.mjs. */
export function buildOperator(root=process.cwd()){
  const provenance=boundedJson(regular(root,'operator-provenance.json'),1024*1024);
  const metadata=inspectSitesMetadata(root,{applicationId:provenance.applicationId,
    projectId:provenance.projectId,compositionDigest:provenance.compositionDigest});
  if(digest(readFileSync(regular(root,'operator.mjs')))!==provenance.operatorDigest||
    provenance.schemaObjects<1||!Number.isSafeInteger(provenance.schemaObjects))
    throw new Error('Sites operator differs from its provenance.');
  const index=regular(root,'dist/server/index.js');
  mkdirSync(path.dirname(index),{recursive:true});
  copyFileSync(regular(root,'operator.mjs'),index);
  stageSitesMetadata(root,root,{applicationId:metadata.applicationId,
    projectId:metadata.projectId,compositionDigest:metadata.compositionDigest});
  verifySitesArtifactTree(root,['dist/server/index.js',...metadata.files.map(file=>file.artifact)]);
  return metadata;
}
