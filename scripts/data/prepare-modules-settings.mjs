import {readFileSync,writeFileSync,lstatSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {generateD1Schema} from './d1-schema.mjs';
import {validateModule} from '../../sdk/contracts/validate.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const source='extensions/native/modules-settings/module/';
function file(relative,missing=false){
  const target=path.join(root,relative);
  for(let cursor=target;cursor!==path.dirname(root.replace(/[\\/]$/,''));cursor=path.dirname(cursor)){
    try{if(lstatSync(cursor).isSymbolicLink())throw new Error('Linked schema artifact refused');}
    catch(error){if(!missing||error.code!=='ENOENT')throw error;}
    if(cursor===path.dirname(cursor))break;
  }
  return target;
}
/** Current model declarations only; no database access and no module-authored migration script. */
export function prepareModulesSettings({check=true}={}){
  const models=JSON.parse(readFileSync(file(`${source}models.json`),'utf8'));
  const manifest=JSON.parse(readFileSync(file(`${source}manifest.json`),'utf8'));
  if(manifest.identity.id!=='creezio.modules-settings'||JSON.stringify(models)!==JSON.stringify(manifest.contracts.models)
    ||validateModule(manifest).errors.length)throw new Error('Modules-settings model contract differs');
  const generated=generateD1Schema(manifest.identity.id,models),target=file('data/schema/modules-settings.sql',!check);
  if(check){if(readFileSync(target,'utf8')!==generated.sql)throw new Error('Generated modules-settings schema differs; run npm run data:modules and review its diff.');}
  else writeFileSync(target,generated.sql);
  return {moduleId:manifest.identity.id,models:models.length,statements:generated.statements.length,sqlBytes:Buffer.byteLength(generated.sql),checked:check,databaseChanged:false};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv.slice(2).some(argument=>argument!=='--write'))throw new Error('Only explicit --write is supported');
  console.log(JSON.stringify(prepareModulesSettings({check:!process.argv.includes('--write')})));
}
