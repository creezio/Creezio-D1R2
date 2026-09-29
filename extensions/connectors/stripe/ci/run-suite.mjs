import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
export function runSuite(name){
  if(!['backend','ui','api-mcp','widgets','package','docs'].includes(name))throw Error('Unknown suite');
  const manifest=JSON.parse(readFileSync(new URL('../module/manifest.json',import.meta.url),'utf8'));
  const tests=manifest.validation.suites[name]?.tests;
  if(!Array.isArray(tests)||!tests.length||tests.some(item=>typeof item!=='string'||
    !new RegExp(`^tests/${name}/[A-Za-z0-9._-]+\\.test\\.mjs$`).test(item)))throw Error('Invalid tests');
  const result=spawnSync(process.execPath,['--test','--test-reporter=tap',
    ...tests.map(item=>path.join(root,item))],{cwd:root,encoding:'utf8',timeout:15000});
  const counts=Object.fromEntries(['tests','pass','fail','cancelled','skipped','todo'].map(key=>{
    const match=[...(result.stdout??'').matchAll(new RegExp('^# '+key+' (\\d+)\\r?$','gm'))];
    return [key,match.length===1?Number(match[0][1]):null];
  }));
  if(result.status!==0||counts.tests<=0||counts.pass!==counts.tests||
    ['fail','cancelled','skipped','todo'].some(key=>counts[key]!==0))
    throw Error(`Suite ${name} failed: ${result.stdout??''}${result.stderr??''}`);
  return {suite:name,status:manifest.validation.suites[name].mode==='not-applicable'?'not-applicable':'passed',
    tests:counts.tests};
}
