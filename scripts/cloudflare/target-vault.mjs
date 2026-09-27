import {randomBytes} from 'node:crypto';
import {lstat,mkdir,open,readFile,realpath} from 'node:fs/promises';
import path from 'node:path';
import {readProviderKeyring} from '../../core/providers/host.ts';

const fail=()=>{throw Object.assign(new Error('Target vault unavailable.'),{code:'vault_unavailable'});};
/** A target's encryption key is retained locally for exact resumption, never in source or plan records. */
export function createTargetVault(root){
  root=path.resolve(root);
  const directory=path.join(root,'.wrangler','delivery','vaults');
  async function paths(){
    for(const name of ['.wrangler','.wrangler/delivery','.wrangler/delivery/vaults']){
      const target=path.join(root,name);
      try{await mkdir(target,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}
      const stat=await lstat(target);if(stat.isSymbolicLink()||!stat.isDirectory())fail();
    }
    for(let target=directory;;target=path.dirname(target)){
      const stat=await lstat(target);if(stat.isSymbolicLink()||!stat.isDirectory())fail();
      if(target===path.dirname(target))break;
    }
    const actual=await realpath(root);
    if(process.platform==='win32'?actual.toLowerCase()!==root.toLowerCase():actual!==root)fail();
  }
  return Object.freeze({async loadOrCreate(transferId){
    if(typeof transferId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(transferId))fail();
    await paths();const secretsPath=path.join(directory,`${transferId}.json`);
    let output;
    try{
      output=await open(secretsPath,'wx',0o600);
      const keyring={activeKeyId:'production',keys:{production:randomBytes(32).toString('base64url')}};
      await output.writeFile(JSON.stringify({CREEZIO_VAULT_KEYRING:JSON.stringify(keyring)})+'\n');
      await output.sync();
    }catch(error){if(error.code!=='EEXIST')throw error;}
    finally{await output?.close();}
    const stat=await lstat(secretsPath);if(stat.isSymbolicLink()||!stat.isFile()||stat.size>8192)fail();
    let payload,keyring;
    try{payload=JSON.parse(await readFile(secretsPath,'utf8'));keyring=JSON.parse(payload.CREEZIO_VAULT_KEYRING);}catch{fail();}
    if(Object.keys(payload).join(',')!=='CREEZIO_VAULT_KEYRING'||keyring.activeKeyId!=='production'
      ||Object.keys(keyring).sort().join(',')!=='activeKeyId,keys'
      ||Object.keys(keyring.keys).join(',')!=='production'||!/^[A-Za-z0-9_-]{43}$/.test(keyring.keys.production)
      ||Buffer.from(keyring.keys.production,'base64url').length!==32)fail();
    return {keyring:readProviderKeyring(payload),secretsPath};
  }});
}
