#!/usr/bin/env node
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateComposition} from '../../sdk/contracts/validate.mjs';
import {compileModuleInventory} from '../../sdk/modules/inventory.mjs';
import {solveModulePlan} from '../../sdk/modules/solver.mjs';

const usage='Usage: node scripts/modules/plan.mjs --current CURRENT.json --choices CHOICES.json --candidates CANDIDATES.json --allowed-origins ORIGINS.json [--root DIRECTORY]\n';

function options(argv) {
  const allowed=new Set(['--current','--choices','--candidates','--allowed-origins','--root']);
  if (argv.length===1 && argv[0]==='--help') return null;
  if (argv.length%2) throw new Error(usage.trim());
  const result={};
  for (let index=0;index<argv.length;index+=2) {
    const key=argv[index],value=argv[index+1];
    if (!allowed.has(key)||Object.hasOwn(result,key)||!value||value.startsWith('--'))
      throw new Error(usage.trim());
    result[key]=value;
  }
  if (['--current','--choices','--candidates','--allowed-origins'].some(key=>!result[key]))
    throw new Error(usage.trim());
  return result;
}
function jsonFile(root,file) {return JSON.parse(readFileSync(path.resolve(root,file),'utf8'));}

/** Local, Node-only plan. Candidate artifacts are compiled from bytes already on disk. */
export function runModulePlanCli(argv,{cwd=process.cwd(),stdout=process.stdout,stderr=process.stderr}={}) {
  try {
    const flags=options(argv);
    if (!flags) {stdout.write(usage);return 0;}
    const root=path.resolve(cwd,flags['--root']??'.');
    const current=jsonFile(root,flags['--current']);
    const choices=jsonFile(root,flags['--choices']);
    const candidates=jsonFile(root,flags['--candidates']);
    const allowedOrigins=jsonFile(root,flags['--allowed-origins']);
    const validation=validateComposition(current.composition,
      {lock:current.lock,modules:current.descriptors});
    if (validation.errors.length) throw new Error(`Current composition invalid: ${validation.errors[0].code}`);
    const inventory=compileModuleInventory({root,candidates,allowedOrigins});
    const plan=solveModulePlan(current,choices,inventory);
    stdout.write(`${JSON.stringify(plan)}\n`);
    return plan.next?0:2;
  } catch (error) {
    stderr.write(`${error instanceof Error?error.message:String(error)}\n`);
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
  process.exitCode=runModulePlanCli(process.argv.slice(2));
