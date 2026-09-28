import {readFileSync,writeFileSync,lstatSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {generateD1Schema} from './d1-schema.mjs';
import {validateModule} from '../../sdk/contracts/validate.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
function file(relative,missing=false){
  const target=path.join(root,relative);
  for(let cursor=target;cursor!==path.dirname(root.replace(/[\\/]$/,''));cursor=path.dirname(cursor)){
    try{if(lstatSync(cursor).isSymbolicLink())throw new Error('Linked schema artifact refused');}
    catch(error){if(!missing||error.code!=='ENOENT')throw error;}
    if(cursor===path.dirname(cursor))break;
  }
  return target;
}
/** Central creation artifact for an official module. Never transforms a database. */
export function prepareNativeModule(name,{check=true,family='native'}={}){
  if(!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(name)
    ||!['native','common','connectors'].includes(family))throw new Error('Invalid module source');
  const source=`extensions/${family}/${name}/module/`;
  const models=JSON.parse(readFileSync(file(`${source}models.json`),'utf8'));
  const manifest=JSON.parse(readFileSync(file(`${source}manifest.json`),'utf8'));
  const errors=validateModule(manifest).errors;
  if(manifest.identity.id!==`creezio.${name}`||JSON.stringify(models)!==JSON.stringify(manifest.contracts.models)||errors.length)
    throw new Error(`Module model contract differs: ${JSON.stringify(errors).slice(0,4096)}`);
  const generated=generateD1Schema(manifest.identity.id,models),target=file(`data/schema/${name}.sql`,!check);
  if(check){if(readFileSync(target,'utf8')!==generated.sql)throw new Error('Generated module schema differs; regenerate centrally and inspect the diff.');}
  else writeFileSync(target,generated.sql);
  return {moduleId:manifest.identity.id,models:models.length,statements:generated.statements.length,sqlBytes:Buffer.byteLength(generated.sql),checked:check,databaseChanged:false};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [name,...args]=process.argv.slice(2);
  const families=args.filter(arg=>arg.startsWith('--family='));
  if(!name||families.length>1||args.some(arg=>arg!=='--write'&&!/^--family=(native|common|connectors)$/.test(arg)))
    throw new Error('Expected a module name, optional --write and --family=native|common|connectors');
  console.log(JSON.stringify(prepareNativeModule(name,{check:!args.includes('--write'),
    family:families[0]?.slice('--family='.length)??'native'})));
}
