import '../local-environment.mjs';
import {createHash} from 'node:crypto';
import {lstatSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {LOCAL_REPOSITORY_ROOT,loadLocalConfiguration,validateLocalStorageResources}
  from './config.mjs';
import {acquireLocalRuntimeLock} from './lock.mjs';
import {createStorageInstallationIdentity,createLocalStorageInventory,
  loadLocalStorageInventory} from './storage-installation.mjs';
import {createTerminalIO} from './tty.mjs';

const refusal=(code,effect='none')=>Object.freeze({ok:false,code,effect});
function inputFile(file){
  if(typeof file!=='string'||!path.isAbsolute(file)||file!==path.resolve(file))
    throw new Error('inventory_input_invalid');
  const stat=lstatSync(file);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size<2||stat.size>16384)
    throw new Error('inventory_input_invalid');
  const bytes=readFileSync(file),digest=createHash('sha256').update(bytes).digest('hex');
  let value;
  try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
  catch{throw new Error('inventory_input_invalid');}
  if(!value||typeof value!=='object'||Array.isArray(value)
    ||Object.keys(value).sort().join(',')!=='resources,schemaVersion'
    ||value.schemaVersion!==1)throw new Error('inventory_input_invalid');
  const resources=validateLocalStorageResources(value.resources);
  if(resources.length===0||!resources.some(item=>item.status==='active'))
    throw new Error('inventory_input_invalid');
  return Object.freeze({digest,resources});
}

/** The only local inventory writer. The CLI does not accept a root or run from a browser. */
export async function initializeLocalStorageInventory({root=LOCAL_REPOSITORY_ROOT,
  inventoryPath,io=createTerminalIO(),lock=acquireLocalRuntimeLock}={}){
  if(io?.interactive!==true)return refusal('terminal_required');
  let lease,result=refusal('inventory_unavailable'),writeStarted=false;
  try{
    const requested=inputFile(inventoryPath);
    const config=loadLocalConfiguration({root});
    if(loadLocalStorageInventory(config.root))return refusal('inventory_exists');
    io.write(`Cible locale : ${config.root}`);
    io.write(`Couple principal : ${config.bindings.databaseId} / ${config.bindings.bucketName}`);
    for(const resource of requested.resources)
      io.write(`Slot ${resource.slot}, contexte ${resource.contextId}, ${resource.status} : `+
        `${resource.databaseId} (${resource.databaseName}) / ${resource.bucketName}`);
    io.write(`Empreinte de l'inventaire source : sha256-${requested.digest}`);
    if(!await io.confirm('Tapez INSTALLER pour fixer une seule fois ces destinations : '))
      return refusal('cancelled');
    lease=await lock(config,'install');
    if(loadLocalStorageInventory(config.root))result=refusal('inventory_exists');
    else{
      const current=inputFile(inventoryPath);
      if(current.digest!==requested.digest
        ||JSON.stringify(current.resources)!==JSON.stringify(requested.resources))
        result=refusal('source_changed');
      else{
        writeStarted=true;
        const storageInstallationId=createStorageInstallationIdentity(config.root);
        const saved=createLocalStorageInventory(config.root,{schemaVersion:1,storageInstallationId,
          resources:requested.resources});
        const loaded=loadLocalConfiguration({root:config.root});
        if(saved.storageInstallationId!==storageInstallationId
          ||loaded.storageInstallationId!==storageInstallationId
          ||JSON.stringify(loaded.storageResources)!==JSON.stringify(requested.resources))
          throw new Error('inventory_readback_failed');
        result=Object.freeze({ok:true,code:'initialized',effect:'confirmed',storageInstallationId,
          resources:requested.resources.length});
      }
    }
  }catch(error){
    result=refusal(['inventory_input_invalid','inventory_exists','source_changed',
      'terminal_required','local_busy','local_path','inventory_readback_failed'].includes(error?.message)
      ?error.message:error?.code==='local_busy'?'local_busy':'inventory_unavailable',
    writeStarted?'unknown':'none');
  }finally{
    if(lease)try{await lease.release();}
    catch{result=refusal('local_cleanup_failed',writeStarted?'unknown':'none');}
  }
  return result;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv.length!==4||process.argv[2]!=='initialize'){
    console.error('Usage: node scripts/local/storage-configuration.mjs initialize ABSOLUTE_JSON_FILE');
    process.exitCode=1;
  }else{
    const result=await initializeLocalStorageInventory({inventoryPath:process.argv[3]});
    console.log(JSON.stringify(result));process.exitCode=result.ok?0:1;
  }
}
