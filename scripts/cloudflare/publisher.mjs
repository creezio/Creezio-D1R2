import {spawn} from 'node:child_process';
import {readFileSync,lstatSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {validateCloudflareTarget,assertCloudflareBuiltConfiguration} from './config.mjs';
import {measureRuntimeArtifacts} from '../quality/runtime.mjs';
import {sourceIdentity,sameSourceIdentity} from '../quality/evidence.mjs';
import {cloudflareArtifactRoot} from './artifact-path.mjs';

const SHA=/^sha256-[a-f0-9]{64}$/;
const ID=/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,55}$/;
const VERSION=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const UPDATE_ID=ID;
const MAX_CONTENT=16*1024*1024;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export class CloudflarePublicationError extends Error {
  constructor(code){super(`Cloudflare publication ${code}.`);this.code=code;}
}
const fail=code=>{throw new CloudflarePublicationError(code);};
function file(root,relative,maxBytes){
  const target=path.resolve(root,relative);
  if(!target.startsWith(root+path.sep))fail('invalid_path');
  for(let current=target;current!==path.dirname(root);current=path.dirname(current))
    if(lstatSync(current).isSymbolicLink())fail('invalid_path');
  const stat=lstatSync(target);
  if(!stat.isFile()||stat.size>maxBytes)fail('invalid_path');
  return target;
}
function markers(transferId,artifact){
  if(!ID.test(transferId)||!artifact||!SHA.test(artifact.artifactDigest)||!SHA.test(artifact.compositionDigest)
    ||!/^[a-f0-9]{40}$/.test(artifact.sourceSha))fail('invalid_input');
  return {tag:`cz-${transferId}`,message:`Creezio ${artifact.artifactDigest} ${artifact.sourceSha}`};
}
/** No shell, project scripts, arbitrary arguments, global Wrangler or credential-bearing command line. */
export async function runCloudflareUpload({root,configPath,transferId,artifact,token,accountId,secretsFile},spawnChild=spawn){
  const marker=markers(transferId,artifact);
  if(typeof token!=='string'||token.length<20||/\s/.test(token)||! /^[a-f0-9]{32}$/.test(accountId))fail('invalid_input');
  const args=[file(root,'node_modules/wrangler/bin/wrangler.js',1024*1024),'deploy','--config',configPath,
    '--no-bundle','--x-autoconfig=false','--tag',marker.tag,'--message',marker.message];
  if(secretsFile)args.push('--secrets-file',secretsFile);
  const env={...process.env,CLOUDFLARE_API_TOKEN:token,CLOUDFLARE_ACCOUNT_ID:accountId,CI:'true',WRANGLER_SEND_METRICS:'false'};
  // These alternate credentials/endpoints cannot silently change the selected account or API.
  for(const key of ['CLOUDFLARE_API_BASE_URL','CF_API_BASE_URL','CLOUDFLARE_API_KEY','CLOUDFLARE_EMAIL','CLOUDFLARE_API_TOKEN_FILE'])delete env[key];
  return new Promise((resolve,reject)=>{
    const child=spawnChild(process.execPath,args,{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
    let bytes=0,overflow=false;
    // Wrangler diagnostics can include account configuration; only a bounded count crosses this interface.
    const consume=chunk=>{bytes=Math.min(bytes+chunk.length,2*1024*1024+1);if(bytes>2*1024*1024)overflow=true;};
    child.stdout?.on('data',consume);child.stderr?.on('data',consume);
    const timer=setTimeout(()=>{overflow=true;child.kill('SIGTERM');},15*60*1000);
    child.once('error',()=>{clearTimeout(timer);reject(new CloudflarePublicationError('outcome_unknown'));});
    child.once('close',code=>{clearTimeout(timer);code===0&&!overflow?resolve({acknowledged:true}):reject(new CloudflarePublicationError('outcome_unknown'));});
  });
}

async function bounded(response,limit){
  if(!response.body||Number(response.headers.get('content-length'))>limit)fail('content_limit');
  const chunks=[];let size=0;
  for await(const chunk of response.body){size+=chunk.length;if(size>limit)fail('content_limit');chunks.push(Buffer.from(chunk));}
  return Buffer.concat(chunks,size);
}
function moduleName(name){
  if(typeof name!=='string')fail('content_format');
  const normalized=name.startsWith('./')?name.slice(2):name;
  if(!normalized||normalized.includes('\\')||normalized.startsWith('/')||normalized.split('/').some(p=>!p||p==='.'||p==='..')
    ||!/^[A-Za-z0-9_./~+-]+\.(?:m?js|wasm)$/.test(normalized))fail('content_format');
  return normalized;
}
function localModule(artifactRoot,name){
  const full=path.resolve(artifactRoot,'dist/server',name);
  if(!full.startsWith(path.join(artifactRoot,'dist/server')+path.sep))fail('content_format');
  return readFileSync(file(artifactRoot,`dist/server/${name}`,MAX_CONTENT));
}
function relativeImports(name,bytes){
  if(!/\.m?js$/.test(name))return [];
  const source=bytes.toString('utf8'),imports=[];
  const pattern=/(?:\bfrom\s*|\bimport\s*\(|\bimport\s*)["'](\.{1,2}\/[^"']+)["']/g;
  for(const match of source.matchAll(pattern)){
    const resolved=path.posix.normalize(path.posix.join(path.posix.dirname(name),match[1]));
    imports.push(moduleName(resolved));
  }
  return imports;
}
function base64Bytes(value){
  if(typeof value!=='string'||value.length>MAX_CONTENT*2||value.length%4!==0)
    fail('content_format');
  const padding=value.endsWith('==')?2:value.endsWith('=')?1:0;
  const contentLength=value.length-padding;
  const expectedBytes=value.length/4*3-padding;
  if(expectedBytes>MAX_CONTENT)fail('content_format');
  for(let index=0;index<contentLength;index++){
    const code=value.charCodeAt(index);
    if(!(code>=65&&code<=90||code>=97&&code<=122||code>=48&&code<=57
      ||code===43||code===47))fail('content_format');
  }
  const bytes=Buffer.from(value,'base64');
  if(bytes.length!==expectedBytes||bytes.toString('base64')!==value)fail('content_format');
  return bytes;
}
function bindingsMatch(bindings,target,requireVault=false){
  return Array.isArray(bindings)
    &&bindings.some(b=>b.name==='DB'&&b.type==='d1'&&b.id===target.databaseId)
    &&bindings.some(b=>b.name==='BUCKET'&&b.type==='r2_bucket'&&b.bucket_name===target.bucketName)
    &&bindings.some(b=>b.name==='CREEZIO_RUNTIME_PROFILE'&&b.type==='plain_text'&&b.text==='cloudflare')
    &&bindings.some(b=>b.name==='CREEZIO_APP_ORIGIN'&&b.type==='plain_text'&&b.text===target.origin)
    &&bindings.some(b=>b.name==='CREEZIO_WIDGET_SANDBOX_ORIGIN'&&b.type==='plain_text'
      &&b.text===target.widgetSandboxOrigin)
    &&(!requireVault||bindings.filter(b=>b.name==='CREEZIO_VAULT_KEYRING').length===1
      &&bindings.find(b=>b.name==='CREEZIO_VAULT_KEYRING').type==='secret_text');
}
/** Stable, read-only deployment identity for conservative code updates. */
export async function inspectCloudflareCurrent({target,controlPlane}){
  target=validateCloudflareTarget(target);
  const first=await controlPlane.deployments(target.workerName);
  const current=first?.deployments?.[0];
  if(!current||typeof current.id!=='string'||!current.id
    ||current.versions?.length!==1||current.versions[0].percentage!==100
    ||!VERSION.test(current.versions[0].version_id))fail('not_confirmed');
  const versionId=current.versions[0].version_id;
  const version=await controlPlane.version(target.workerName,versionId);
  const settings=await controlPlane.workerSettings(target.workerName);
  if(version?.id!==versionId||!bindingsMatch(settings?.bindings,target,true))fail('binding_mismatch');
  const second=await controlPlane.deployments(target.workerName);
  if(second?.deployments?.[0]?.id!==current.id
    ||second.deployments[0].versions?.length!==1
    ||second.deployments[0].versions[0].percentage!==100
    ||second.deployments[0].versions[0].version_id!==versionId)fail('deployment_changed');
  const tag=settings.annotations?.['workers/tag'],message=settings.annotations?.['workers/message'];
  if(tag!==undefined&&(typeof tag!=='string'||tag.length>1024)
    ||message!==undefined&&(typeof message!=='string'||message.length>1024))fail('not_confirmed');
  return Object.freeze({deploymentId:current.id,versionId,tag:tag??null,message:message??null,
    bindings:Object.freeze(settings.bindings.map(item=>Object.freeze(structuredClone(item))))});
}
async function verifyRemoteModules({artifactRoot,target,versionId,token,fetcher,local}){
  if(!VERSION.test(versionId)||typeof token!=='string'||token.length<20||/\s/.test(token))fail('invalid_input');
  let response;
  try{response=await fetcher(`https://api.cloudflare.com/client/v4/accounts/${target.accountId}/workers/workers/${target.workerName}/versions/${versionId}?include=modules`,
    {redirect:'error',signal:AbortSignal.timeout(20000),headers:{Authorization:`Bearer ${token}`}});}
  catch{fail('content_unavailable');}
  if(!response?.ok||response.redirected)fail('content_unavailable');
  let data;try{data=JSON.parse((await bounded(response,MAX_CONTENT)).toString('utf8'));}
  catch{fail('content_format');}
  const version=data?.result;
  if(data?.success!==true||version?.id!==versionId||!Array.isArray(version.modules)
    ||version.modules.length<1||version.modules.length>256)fail('content_format');
  const modules=new Map(),moduleTypes=new Map(),configurationSeen=new Set();let configurationModules=0;
  for(const part of version.modules){
    if(!part||typeof part.name!=='string'||typeof part.content_type!=='string')fail('content_format');
    const bytes=base64Bytes(part.content_base64);
    if(['_headers','_redirects'].includes(part.name)){
      if(configurationSeen.has(part.name))fail('content_format');
      configurationSeen.add(part.name);
      const localFile=file(artifactRoot,`dist/client/${part.name}`,128*1024);
      if(!readFileSync(localFile).equals(bytes))fail('content_mismatch');
      configurationModules++;continue;
    }
    const name=moduleName(part.name);
    if(modules.has(name)||!/^(?:application|text)\/(?:javascript(?:\+module)?|x-javascript|ecmascript|octet-stream|wasm)$/.test(part.content_type))
      fail('content_format');
    modules.set(name,bytes);
    moduleTypes.set(name,part.content_type);
  }
  const entry=moduleName(version.main_module);
  if(entry!=='index.js'||!modules.has(entry))fail('content_mismatch');
  let built;
  try{built=JSON.parse(readFileSync(file(artifactRoot,'dist/server/wrangler.json',128*1024),'utf8'));}
  catch{fail('content_format');}
  const inventory=new Set(local.files.filter(item=>item.path.startsWith('dist/server/')&&/\.(?:m?js|wasm)$/.test(item.path))
    .map(item=>item.path.slice('dist/server/'.length)));
  let expected;
  if(built.no_bundle===true){
    // Wrangler's no-bundle upload includes every local ES module selected by
    // these explicit rules, including modules not reachable by static imports.
    if(built.find_additional_modules!==undefined&&built.find_additional_modules!==false
      ||JSON.stringify(built.rules)!==JSON.stringify([{
        type:'ESModule',globs:['**/*.js','**/*.mjs']}])
      ||built.main!=='index.js'||[...inventory].some(name=>! /\.m?js$/.test(name)))
      fail('content_format');
    expected=new Set(inventory);
  }else{
    expected=new Set();const pending=[entry];
    while(pending.length){
      const name=pending.pop();if(expected.has(name))continue;
      if(!inventory.has(name))fail('content_mismatch');expected.add(name);
      for(const imported of relativeImports(name,localModule(artifactRoot,name)))pending.push(imported);
    }
  }
  if(expected.size!==modules.size||[...modules.keys()].some(name=>!expected.has(name)))fail('content_mismatch');
  for(const [name,bytes] of modules){
    const type=moduleTypes.get(name);
    if(type!==(/\.wasm$/.test(name)?'application/wasm':'application/javascript+module'))
      fail('content_format');
    const actual=localModule(artifactRoot,name);
    if(actual.length!==bytes.length||sha(actual)!==sha(bytes))fail('content_mismatch');
  }
  return {modules:modules.size,bytes:[...modules.values()].reduce((n,b)=>n+b.length,0),
    configurationModules,
    excludedLocalModules:inventory.size-expected.size};
}
async function verifyPublicAssets({root,target,fetcher,local}){
  const assets=local.files.filter(item=>item.path.startsWith('dist/client/'))
    .filter(item=>!['dist/client/_headers','dist/client/_redirects','dist/client/.assetsignore']
      .includes(item.path)&&!item.path.startsWith('dist/client/.vite/'));
  if(assets.length>256||assets.reduce((n,item)=>n+item.bytes,0)>8*1024*1024)fail('content_limit');
  for(const item of assets){
    const relative=item.path.slice('dist/client/'.length);
    const url=`${target.origin}/${relative.split('/').map(encodeURIComponent).join('/')}`;
    let response;
    try{response=await fetcher(url,{redirect:'error',signal:AbortSignal.timeout(15000),cache:'no-store'});}
    catch{fail('asset_unavailable');}
    if(response?.status!==200||response.redirected||response.headers.get('set-cookie'))fail('asset_unavailable');
    const bytes=await bounded(response,item.bytes);
    if(bytes.length!==item.bytes||sha(bytes)!==item.sha256)fail('asset_mismatch');
  }
  return {assets:assets.length,bytes:assets.reduce((n,item)=>n+item.bytes,0)};
}

/** Read-only reconciliation. Never uploads again after an ambiguous response. */
export async function inspectCloudflareDelivery({artifactRoot,target,transferId,artifact,token,
  controlPlane,fetcher=fetch,requireVault=false}){
  artifactRoot=path.resolve(artifactRoot);
  target=validateCloudflareTarget(target);
  const marker=markers(transferId,artifact);
  const deployments=await controlPlane.deployments(target.workerName);
  const current=deployments?.deployments?.[0];
  if(!current||current.versions?.length!==1||current.versions[0].percentage!==100)fail('not_confirmed');
  const versionId=current.versions[0].version_id;
  const version=await controlPlane.version(target.workerName,versionId);
  const settings=await controlPlane.workerSettings(target.workerName);
  if(version?.id!==versionId||settings?.annotations?.['workers/tag']!==marker.tag
    ||settings?.annotations?.['workers/message']!==marker.message)fail('not_confirmed');
  if(!bindingsMatch(settings.bindings,target,requireVault))fail('binding_mismatch');
  const local=measureRuntimeArtifacts(artifactRoot);
  if(local.digest!==artifact.artifactDigest)fail('artifact_changed');
  const remoteModules=await verifyRemoteModules({artifactRoot,target,versionId,token,fetcher,local});
  const remoteAssets=await verifyPublicAssets({root:artifactRoot,target,fetcher,local});
  let session;
  try{session=await fetcher(`${target.origin}/api/access/admin/session`,
    {redirect:'error',signal:AbortSignal.timeout(15000)});}
  catch{fail('probe_failed');}
  if(session?.status!==401||session.redirected||session.headers.get('set-cookie'))fail('probe_failed');
  let body;
  try{body=JSON.parse((await bounded(session,4096)).toString('utf8'));}
  catch{fail('probe_failed');}
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.hasOwn(body,'session')
    ||body.error?.code!=='authentication_required')fail('probe_failed');
  const after=await controlPlane.deployments(target.workerName);
  if(after.deployments?.[0]?.id!==current.id)fail('deployment_changed');
  return {deploymentId:current.id,url:target.origin,publishedSha:artifact.sourceSha,artifact,
    remoteVerified:{modules:remoteModules.modules,moduleBytes:remoteModules.bytes,
      configurationModules:remoteModules.configurationModules,
      excludedLocalModules:remoteModules.excludedLocalModules,
      assets:remoteAssets.assets,assetBytes:remoteAssets.bytes}};
}

export function createCloudflarePublisher({root,artifactRoot,target,token,controlPlane,fetcher=fetch,upload=runCloudflareUpload}){
  if(typeof root!=='string'||typeof artifactRoot!=='string'||!path.isAbsolute(artifactRoot))fail('invalid_configuration');
  root=path.resolve(root);artifactRoot=path.resolve(artifactRoot);target=validateCloudflareTarget(target);
  const initial=cloudflareArtifactRoot(root);
  const relative=path.relative(root,artifactRoot).replaceAll('\\','/');
  const updateId=/^\.wrangler\/delivery\/updates\/([^/]+)\/artifact$/.exec(relative)?.[1]??null;
  if(artifactRoot!==initial&&(updateId===null||!UPDATE_ID.test(updateId)
    ||artifactRoot!==cloudflareArtifactRoot(root,updateId)))fail('invalid_configuration');
  async function inspectCurrent(){return inspectCloudflareCurrent({target,controlPlane});}
  async function inspect({transferId,artifact}){
    return inspectCloudflareDelivery({artifactRoot,target,transferId,artifact,token,
      controlPlane,fetcher,requireVault:updateId!==null});
  }
  async function deliver({transferId,artifact,secretsPath,expectedPreviousVersionId,
    expectedPreviousDeploymentId}){
    if(updateId!==null){
      if(transferId!==updateId||secretsPath!==undefined
        ||!VERSION.test(expectedPreviousVersionId??'')
        ||typeof expectedPreviousDeploymentId!=='string'||!expectedPreviousDeploymentId)
        fail('invalid_input');
    }else if(expectedPreviousVersionId!==undefined||expectedPreviousDeploymentId!==undefined)
      fail('invalid_input');
    if(updateId!==null){
      const current=await inspectCurrent();
      if(current.versionId!==expectedPreviousVersionId
        ||current.deploymentId!==expectedPreviousDeploymentId)fail('deployment_changed');
    }
    const configPath=file(artifactRoot,'dist/server/wrangler.json',128*1024);
    const build=JSON.parse(readFileSync(file(artifactRoot,'.quality/cloudflare-build.json',2*1024*1024),'utf8'));
    assertCloudflareBuiltConfiguration(JSON.parse(readFileSync(configPath,'utf8')),target);
    const source=sourceIdentity(root);
    if(source.dirty||!sameSourceIdentity(build.source,source)||source.head!==artifact.sourceSha
      ||build.artifact?.digest!==artifact.artifactDigest||build.compositionDigest!==artifact.compositionDigest
      ||measureRuntimeArtifacts(artifactRoot).digest!==artifact.artifactDigest)fail('artifact_changed');
    let secretsFile;
    if(secretsPath){
      secretsFile=file(root,secretsPath,8192);
      if(!secretsFile.startsWith(path.join(root,'.wrangler')+path.sep))fail('invalid_path');
      const secrets=JSON.parse(readFileSync(secretsFile,'utf8'));
      if(Object.keys(secrets).join(',')!=='CREEZIO_VAULT_KEYRING'||typeof secrets.CREEZIO_VAULT_KEYRING!=='string')fail('invalid_secrets');
    }
    // Recheck after local validation, immediately before the single upload.
    // Cloudflare offers no conditional deploy primitive, so later races remain uncertain.
    if(updateId!==null){
      const current=await inspectCurrent();
      if(current.versionId!==expectedPreviousVersionId
        ||current.deploymentId!==expectedPreviousDeploymentId)fail('deployment_changed');
    }
    await upload({root,configPath,transferId,artifact,token,accountId:target.accountId,secretsFile});
    if(!sameSourceIdentity(source,sourceIdentity(root))||measureRuntimeArtifacts(artifactRoot).digest!==artifact.artifactDigest)fail('artifact_changed');
    return inspect({transferId,artifact});
  }
  return Object.freeze({deliver,inspect,inspectCurrent});
}
