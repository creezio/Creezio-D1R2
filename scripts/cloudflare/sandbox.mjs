import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {lstatSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {validateCloudflareTarget} from './config.mjs';
import {sourceIdentity, sameSourceIdentity} from '../quality/evidence.mjs';

const SHA = /^sha256-[a-f0-9]{64}$/;
const TRANSFER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,55}$/;
const SUBDOMAIN = /^[a-z0-9][a-z0-9-]{0,62}$/;
const MAX_SCRIPT = 2 * 1024 * 1024;
const MAX_VERSION_RESPONSE = 4 * 1024 * 1024;
const hash = bytes => `sha256-${createHash('sha256').update(bytes).digest('hex')}`;
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
export class CloudflareSandboxError extends Error {
  constructor(code) { super(`Cloudflare widget sandbox ${code}.`); this.code = code; }
}
const fail = code => { throw new CloudflareSandboxError(code); };

function confinedFile(root, relative, maxBytes) {
  const target = path.resolve(root, relative);
  if (!target.startsWith(root + path.sep)) fail('invalid_path');
  for (let cursor = target; cursor !== path.dirname(root); cursor = path.dirname(cursor)) {
    const stat = lstatSync(cursor);
    if (stat.isSymbolicLink()) fail('invalid_path');
  }
  const stat = lstatSync(target);
  if (!stat.isFile() || stat.size > maxBytes) fail('invalid_path');
  return target;
}
function sandboxName(target) {
  const name = `${target.workerName}-widgets`;
  if (!/^[a-z][a-z0-9-]{2,62}$/.test(name)) fail('invalid_name');
  return name;
}
function marker(record) {
  if (!TRANSFER.test(record.transferId) || !SHA.test(record.artifactDigest) ||
      !/^[a-f0-9]{40}$/.test(record.sourceSha)) fail('invalid_record');
  return {tag: `czw-${record.transferId}`,
    message: `Creezio widget sandbox ${record.artifactDigest} ${record.sourceSha}`};
}
function buildReceipt(root, target, name) {
  const script = readFileSync(confinedFile(root, '.creezio/widget-sandbox/worker.mjs', MAX_SCRIPT));
  const config = JSON.parse(readFileSync(confinedFile(root,
    '.creezio/widget-sandbox/wrangler.json', 16 * 1024), 'utf8'));
  const evidence = JSON.parse(readFileSync(confinedFile(root,
    '.creezio/widget-sandbox/build.json', 64 * 1024), 'utf8'));
  const expectedConfig = {name, account_id: target.accountId, main: 'worker.mjs',
    compatibility_date: '2026-05-15', no_bundle: true, workers_dev: true,
    observability: {enabled: false}};
  if (!same(config, expectedConfig) || evidence.name !== name ||
      evidence.accountId !== target.accountId ||
      !same(evidence.hostOrigins, [target.origin]) ||
      evidence.artifactDigest !== hash(script) || evidence.bytes !== script.length ||
      !Array.isArray(evidence.profileIds) || !evidence.profileIds.length ||
      !Array.isArray(evidence.assetPaths) ||
      !evidence.assetPaths.includes('/sandbox-config.js')) fail('build_mismatch');
  return {scriptDigest: evidence.artifactDigest, scriptBytes: script.length,
    configPath: confinedFile(root, '.creezio/widget-sandbox/wrangler.json', 16 * 1024)};
}
function spawnBounded(program, args, options, spawnChild, maxMs) {
  return new Promise((resolve,reject) => {
    const child = spawnChild(program,args,{...options,windowsHide:true,stdio:['ignore','pipe','pipe']});
    let bytes = 0, overflow = false, done = false;
    const consume = chunk => { bytes += chunk.length; if (bytes > 2 * 1024 * 1024) overflow = true; };
    child.stdout?.on('data',consume); child.stderr?.on('data',consume);
    const timer = setTimeout(() => { overflow = true; child.kill('SIGTERM'); }, maxMs);
    const finish = success => { if (done) return; done = true; clearTimeout(timer);
      success && !overflow ? resolve() : reject(new CloudflareSandboxError('outcome_unknown')); };
    child.once('error',() => finish(false)); child.once('close',code => finish(code === 0));
  });
}
export async function runSandboxBuild({root,name,accountId,appOrigin},spawnChild = spawn) {
  if (!path.isAbsolute(root) || !/^[a-z][a-z0-9-]{2,62}$/.test(name) ||
      !/^[a-f0-9]{32}$/.test(accountId)) fail('invalid_input');
  const script = confinedFile(root, 'scripts/widgets/build-sandbox.mjs', 64 * 1024);
  const env = {...process.env, CREEZIO_WIDGET_SANDBOX_WORKER: name,
    CLOUDFLARE_ACCOUNT_ID: accountId, CREEZIO_WIDGET_HOST_ORIGINS: JSON.stringify([appOrigin])};
  // Compilation has no remote authority, secret, or alternate Cloudflare endpoint.
  for (const key of ['CLOUDFLARE_API_TOKEN','CLOUDFLARE_API_KEY','CLOUDFLARE_EMAIL',
    'CF_API_BASE_URL','CLOUDFLARE_API_BASE_URL','CLOUDFLARE_API_TOKEN_FILE']) delete env[key];
  await spawnBounded(process.execPath,[script],{cwd:root,env},spawnChild,120000);
}
export async function runSandboxUpload({root,configPath,record,token},spawnChild = spawn) {
  if (!path.isAbsolute(root) || configPath !== path.join(root,'.creezio/widget-sandbox/wrangler.json') ||
      typeof token !== 'string' || token.length < 20 || /\s/.test(token) ||
      !/^[a-f0-9]{32}$/.test(record.accountId)) fail('invalid_input');
  const labels = marker(record);
  const wrangler = confinedFile(root,'node_modules/wrangler/bin/wrangler.js',1024*1024);
  const env = {...process.env, CLOUDFLARE_API_TOKEN:token,
    CLOUDFLARE_ACCOUNT_ID:record.accountId, CI:'true', WRANGLER_SEND_METRICS:'false'};
  for(const key of ['CLOUDFLARE_API_BASE_URL','CF_API_BASE_URL','CLOUDFLARE_API_KEY',
    'CLOUDFLARE_EMAIL','CLOUDFLARE_API_TOKEN_FILE']) delete env[key];
  await spawnBounded(process.execPath,[wrangler,'deploy','--config',configPath,
    '--no-bundle','--x-autoconfig=false','--tag',labels.tag,'--message',labels.message],
  {cwd:root,env},spawnChild,15*60*1000);
}

async function bounded(response,maxBytes) {
  if (!response.body || Number(response.headers.get('content-length')) > maxBytes) fail('content_limit');
  const chunks=[]; let count=0;
  for await (const chunk of response.body) {
    count += chunk.length;
    if (count > maxBytes) fail('content_limit');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks,count);
}
export async function readSandboxContent({accountId,name,versionId,token,fetcher=fetch}) {
  if(!/^[a-f0-9]{32}$/.test(accountId)||!/^[a-z][a-z0-9-]{2,62}$/.test(name)||
      !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(versionId)||
      typeof token!=='string'||token.length<20||/\s/.test(token))fail('invalid_input');
  const url=`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/workers/${name}/versions/${versionId}?include=modules`;
  let response;
  try {response=await fetcher(url,{redirect:'error',signal:AbortSignal.timeout(20000),
    headers:{Authorization:`Bearer ${token}`}});}catch{fail('content_unavailable');}
  if(!response?.ok||response.redirected)fail('content_unavailable');
  let data;try{data=JSON.parse((await bounded(response,MAX_VERSION_RESPONSE)).toString('utf8'));}
  catch{fail('content_format');}
  const version=data?.result,modules=version?.modules;
  if(data?.success!==true||version?.id!==versionId||version?.main_module!=='worker.mjs'
    ||!Array.isArray(modules)||modules.length!==1||modules[0]?.name!=='worker.mjs'
    ||!/^(?:application|text)\/javascript(?:\+module)?$/.test(modules[0].content_type??''))
    fail('content_format');
  const encoded=modules[0].content_base64;
  if(typeof encoded!=='string'||encoded.length>MAX_VERSION_RESPONSE
    ||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded))
    fail('content_format');
  const body=Buffer.from(encoded,'base64');
  if(body.length>MAX_SCRIPT||body.toString('base64')!==encoded)fail('content_format');
  return {digest:hash(body),bytes:body.length};
}

function receipt(record,deploymentId,versionId) {
  return Object.freeze({transferId:record.transferId,workerName:record.workerName,
    origin:record.sandboxOrigin,appOrigin:record.appOrigin,sourceSha:record.sourceSha,
    artifactDigest:record.artifactDigest,artifactBytes:record.artifactBytes,
    deploymentId,versionId});
}
export function createCloudflareSandboxPublisher({root,target,token,tokenScope='account',
  controlPlane,journal,fetcher=fetch,build=runSandboxBuild,upload=runSandboxUpload,
  source=sourceIdentity}) {
  root=path.resolve(root);target=validateCloudflareTarget(target);
  if(!['account','user'].includes(tokenScope)||typeof token!=='string'||token.length<20||/\s/.test(token)||
    !controlPlane||controlPlane.accountId!==target.accountId||
    !journal||typeof journal.load!=='function'||typeof journal.create!=='function'||
    typeof journal.compareAndSave!=='function')fail('invalid_configuration');
  const name=sandboxName(target);
  async function connection() {
    const value=await controlPlane.inspectConnection(tokenScope);
    if(value.accountId!==target.accountId||!SUBDOMAIN.test(value.workersSubdomain??'')||
      target.origin!==`https://${target.workerName}.${value.workersSubdomain}.workers.dev`||
      target.widgetSandboxOrigin!==`https://${name}.${value.workersSubdomain}.workers.dev`)
      fail('target_mismatch');
    return value;
  }
  async function remote(record) {
    const before=await controlPlane.deployments(name);
    const deployment=before?.deployments?.[0]??null;
    const settings=await controlPlane.workerSettings(name);
    if(!deployment&&!settings)return {state:'absent'};
    if(!deployment||!settings||deployment.versions?.length!==1||
      deployment.versions[0].percentage!==100)fail('remote_conflict');
    const versionId=deployment.versions[0].version_id;
    const version=await controlPlane.version(name,versionId),labels=marker(record);
    if(version?.id!==versionId||settings.annotations?.['workers/tag']!==labels.tag||
      settings.annotations?.['workers/message']!==labels.message||
      !Array.isArray(settings.bindings)||settings.bindings.length!==0)fail('remote_conflict');
    const content=await readSandboxContent({accountId:target.accountId,name,versionId,token,fetcher});
    if(content.digest!==record.artifactDigest||content.bytes!==record.artifactBytes)fail('remote_conflict');
    let probe;
    try{probe=await fetcher(`${target.widgetSandboxOrigin}/sandbox-config.js`,
      {redirect:'error',signal:AbortSignal.timeout(15000)});}catch{fail('probe_unavailable');}
    if(!probe||probe.status!==200||probe.redirected||probe.headers.get('set-cookie'))fail('probe_unavailable');
    const text=await bounded(probe,128*1024);
    if(!text.includes(Buffer.from(JSON.stringify([record.appOrigin]))))fail('probe_mismatch');
    const after=await controlPlane.deployments(name);
    if(after?.deployments?.[0]?.id!==deployment.id)fail('deployment_changed');
    return {state:'matching',receipt:receipt(record,deployment.id,versionId)};
  }
  function checkedRecord(record,transferId) {
    if(!record||record.schemaVersion!==1||record.transferId!==transferId||
      !Number.isSafeInteger(record.revision)||record.revision<1||
      !['prepared','upload-intent','confirmed'].includes(record.stage)||
      record.workerName!==name||record.accountId!==target.accountId||
      record.appOrigin!==target.origin||record.sandboxOrigin!==target.widgetSandboxOrigin||
      !SHA.test(record.artifactDigest)||!Number.isSafeInteger(record.artifactBytes)||
      record.artifactBytes<1||record.artifactBytes>MAX_SCRIPT||
      !/^[a-f0-9]{40}$/.test(record.sourceSha??''))fail('journal_conflict');
    return record;
  }
  async function inspectSandbox({transferId}) {
    if(!TRANSFER.test(transferId??''))fail('invalid_input');
    await connection();
    let record=checkedRecord(await journal.load(transferId),transferId);
    try {
      const current=await remote(record);
      if(current.state!=='matching')return {state:'unknown'};
      if(record.stage!=='confirmed') {
        const next={...record,stage:'confirmed',revision:record.revision+1,
          deploymentId:current.receipt.deploymentId,versionId:current.receipt.versionId};
        await journal.compareAndSave(record,next);record=next;
      }
      return {state:'confirmed',receipt:current.receipt};
    } catch(error) {
      if(error instanceof CloudflareSandboxError&&['remote_conflict','journal_conflict'].includes(error.code))throw error;
      return {state:'unknown'};
    }
  }
  async function publishSandbox({transferId,previousReceipt=null}) {
    if(!TRANSFER.test(transferId??''))fail('invalid_input');
    const currentConnection=await connection();
    let record=await journal.load(transferId);
    if(record&&checkedRecord(record,transferId).stage!=='prepared')return inspectSandbox({transferId});
    const initialSource=source(root);
    if(initialSource.dirty||!/^[a-f0-9]{40}$/.test(initialSource.head??''))fail('source_dirty');
    await build({root,name,accountId:target.accountId,appOrigin:target.origin});
    const compiled=buildReceipt(root,target,name);
    if(!sameSourceIdentity(initialSource,source(root)))fail('source_changed');
    const planned={schemaVersion:1,revision:1,transferId,stage:'prepared',
      workerName:name,accountId:target.accountId,appOrigin:target.origin,
      sandboxOrigin:target.widgetSandboxOrigin,tokenId:currentConnection.tokenId,
      sourceSha:initialSource.head,artifactDigest:compiled.scriptDigest,
      artifactBytes:compiled.scriptBytes,previousDeploymentId:previousReceipt?.deploymentId??null,
      deploymentId:null,versionId:null};
    async function assertPrior() {
      const existing=await controlPlane.deployments(name);
      const settings=await controlPlane.workerSettings(name);
      if(existing?.deployments?.length||settings) {
        if(!previousReceipt||previousReceipt.workerName!==name||
          previousReceipt.origin!==target.widgetSandboxOrigin||
          previousReceipt.appOrigin!==target.origin||
          previousReceipt.transferId===transferId)fail('worker_exists');
        const old={...planned,transferId:previousReceipt.transferId,
          sourceSha:previousReceipt.sourceSha,artifactDigest:previousReceipt.artifactDigest,
          artifactBytes:previousReceipt.artifactBytes};
        const inspected=await remote(old);
        if(inspected.state!=='matching'||inspected.receipt.deploymentId!==previousReceipt.deploymentId||
          inspected.receipt.versionId!==previousReceipt.versionId)fail('worker_exists');
      } else if(previousReceipt)fail('worker_missing');
    }
    if(record) {
      if(!same({...record,revision:1},{...planned,revision:1}))fail('journal_conflict');
    } else {
      await assertPrior();
      await journal.create(planned);record=planned;
    }
    // A prepared journal can be resumed, but never used to overwrite a Worker
    // that appeared or changed after the initial inspection.
    await assertPrior();
    record={...record,stage:'upload-intent',revision:record.revision+1};
    await journal.compareAndSave(planned,record);
    await assertPrior();
    try {await upload({root,configPath:compiled.configPath,record,token});}
    catch {return inspectSandbox({transferId});}
    if(!sameSourceIdentity(initialSource,source(root))||
      buildReceipt(root,target,name).scriptDigest!==compiled.scriptDigest)fail('source_changed');
    return inspectSandbox({transferId});
  }
  return Object.freeze({publishSandbox,inspectSandbox});
}
