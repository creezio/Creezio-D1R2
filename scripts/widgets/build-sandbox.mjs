import {mkdirSync,writeFileSync,lstatSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {compileWidgetSandbox} from './sandbox.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const name=process.env.CREEZIO_WIDGET_SANDBOX_WORKER;
const accountId=process.env.CLOUDFLARE_ACCOUNT_ID;
const hostOrigins=JSON.parse(process.env.CREEZIO_WIDGET_HOST_ORIGINS??'null');
if(typeof name!=='string'||!/^[a-z][a-z0-9-]{0,62}$/.test(name)||typeof accountId!=='string'||!/^[a-f0-9]{32}$/.test(accountId))
  throw new Error('Explicit sandbox Worker name and Cloudflare account are required.');
const {widgetCatalog}=await import('../../.creezio/generated/widget-catalog.ts');
const compiled=compileWidgetSandbox({catalog:widgetCatalog,hostOrigins});
const output=resolve(root,'.creezio/widget-sandbox');
for(const path of [resolve(root,'.creezio'),output]){
  const info=lstatSync(path,{throwIfNoEntry:false});
  if(info&&(!info.isDirectory()||info.isSymbolicLink()))throw new Error('Linked sandbox output refused.');
}
mkdirSync(output,{recursive:true});
for(const name of ['worker.mjs','wrangler.json','build.json']){
  const info=lstatSync(resolve(output,name),{throwIfNoEntry:false});
  if(info&&(!info.isFile()||info.isSymbolicLink()))throw new Error('Linked sandbox file refused.');
}
writeFileSync(resolve(output,'worker.mjs'),compiled.script);
writeFileSync(resolve(output,'wrangler.json'),JSON.stringify({name,account_id:accountId,main:'worker.mjs',
  compatibility_date:'2026-05-15',no_bundle:true,workers_dev:true,observability:{enabled:false}},null,2)+'\n');
const evidence={name,accountId,artifactDigest:compiled.digest,hostOrigins:compiled.hostOrigins,
  profileIds:compiled.profileIds,assetPaths:compiled.assetPaths,bytes:Buffer.byteLength(compiled.script)};
writeFileSync(resolve(output,'build.json'),JSON.stringify(evidence,null,2)+'\n');
console.log(JSON.stringify(evidence));
