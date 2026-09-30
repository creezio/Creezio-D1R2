import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {temporaryDirectory} from '../quality/temporary.mjs';
import {contractIntegrity,validateModule} from '../../sdk/contracts/validate.mjs';
import {deterministicModuleArchive,packModuleArtifacts} from '../../scripts/modules/archives.mjs';
import {verifyPackageReceipt} from '../../scripts/modules/package-receipt.mjs';
import {compileModuleInventory} from '../../sdk/modules/inventory.mjs';
import {loadRuntimeComposition} from '../../scripts/build/compose-runtime.mjs';
import {lockFor} from '../contracts/helpers.mjs';

const json=value=>`${JSON.stringify(value,null,2)}\n`;
const sha=bytes=>`sha256-${createHash('sha256').update(bytes).digest('hex')}`;
function write(root,name,bytes){
  const target=path.join(root,...name.split('/'));
  mkdirSync(path.dirname(target),{recursive:true});writeFileSync(target,bytes);return target;
}

/** Small existing merchant.cart fixture, installed from exact bytes without npm or a second app. */
export async function installedConsumerPackage(t,original,handlerSource){
  const root=temporaryDirectory(t,'creezio-catalog-consumer-');
  const testCase=structuredClone(original);
  const cart=testCase.modules.find(item=>item.identity.id==='merchant.cart');
  const packageName='@fixture-merchant/cart';
  const packageJson={name:packageName,version:cart.identity.version,private:true,type:'module',
    files:cart.packaging.runtime.files.filter(file=>file!=='package.json'),
    exports:Object.fromEntries(cart.packaging.runtime.files.filter(file=>file!=='package.json')
      .map(file=>[`./${file}`,`./${file}`]))};
  assert.deepEqual(validateModule(cart).errors,[]);
  const source=path.join(root,'author');
  for(const file of new Set([...cart.packaging.runtime.files,...cart.packaging.validation.files])){
    const value=file==='package.json'?json(packageJson):
      file==='module/manifest.json'?json(cart):
      file==='module/operations.mjs'?readFileSync(handlerSource):
      file==='module/operations.ts'?'export const list=()=>({items:[]});\nexport const update=()=>({ok:true});\nexport const adminConfigure=()=>({ok:true});\nexport const rebuildIndex=()=>({ok:true});\n':
      file.endsWith('.json')?'{}\n':
      file.endsWith('.html')?'<!doctype html><html><body>Fixture cart</body></html>\n':
      file.endsWith('.css')?'body { color: black; }\n':
      file.endsWith('.ts')?'export const fixture=()=>null;\n':
      file.endsWith('.mjs')?'export const fixture=true;\n':
      `Fixture merchant.cart: ${file}\n`;
    write(source,file,value);
  }
  const runtime=deterministicModuleArchive(cart.packaging.runtime.files.map(file=>({
    path:`package/${file}`,bytes:readFileSync(path.join(source,...file.split('/')))})));
  const validation=deterministicModuleArchive(cart.packaging.validation.files.map(file=>({
    path:file,bytes:readFileSync(path.join(source,...file.split('/')))})));
  const runtimePath=write(root,'archives/cart-runtime.tgz',runtime);
  write(root,'archives/cart-validation.tgz',validation);
  const receipt={schemaVersion:'1.0.0',module:{id:cart.identity.id,origin:cart.identity.origin,
    version:cart.identity.version,source:cart.identity.source},contractIntegrity:contractIntegrity(cart),
    runtime:{integrity:sha(runtime),location:{kind:'local',path:'archives/cart-runtime.tgz'}},
    validation:{integrity:sha(validation),location:{kind:'local',path:'archives/cart-validation.tgz'}},
    policy:cart.validation.policy};
  const receiptPath='archives/cart-receipt.json';write(root,receiptPath,json(receipt));
  const moduleDirectory=path.join(root,'node_modules','@fixture-merchant','cart');
  mkdirSync(moduleDirectory,{recursive:true});
  const extracted=spawnSync('tar',['-xzf',runtimePath,'-C',moduleDirectory,'--strip-components=1'],
    {encoding:'utf8',timeout:30000});
  assert.equal(extracted.status,0,extracted.stderr??extracted.error?.message);
  const verified=verifyPackageReceipt({root,receiptPath,moduleDirectory,descriptor:cart});
  const packed=packModuleArtifacts({root,moduleDirectory,moduleId:cart.identity.id,descriptor:cart,
    detachedValidation:verified.validation,cacheDetachedValidation:true});
  testCase.composition.modules[0].source={kind:'workspace',path:'extensions/native/access'};
  testCase.composition.modules[1].source={kind:'workspace',path:'extensions/common/catalog'};
  testCase.composition.modules[2].source={kind:'package',name:packageName};
  testCase.lock=lockFor(testCase.composition,testCase.modules);
  const cartNode=testCase.lock.modules.find(item=>item.moduleId===cart.identity.id);
  cartNode.runtime={integrity:packed.runtime.integrity,
    location:{kind:'local',path:packed.runtime.path}};
  cartNode.validation={integrity:packed.validation.integrity,
    location:{kind:'local',path:packed.validation.path}};
  for(const [id,directory] of [['creezio.access','extensions/native/access'],
    ['creezio.catalog','extensions/common/catalog']]){
    write(root,`${directory}/module/manifest.json`,json(testCase.modules.find(item=>item.identity.id===id)));
  }
  write(root,'configuration/composition.json',json(testCase.composition));
  write(root,'configuration/composition.lock.json',json(testCase.lock));
  const inventory=compileModuleInventory({root,candidates:[{source:{kind:'package',name:packageName},
    lockNode:cartNode,validationReceipt:receiptPath}],allowedOrigins:[cart.identity.origin]});
  assert.equal(inventory.candidates[0].moduleId,cart.identity.id);
  const loaded=loadRuntimeComposition({root});
  assert.deepEqual(loaded.located.map(item=>item.descriptor.identity.id),
    testCase.modules.map(item=>item.identity.id));
  const imported=await import(pathToFileURL(path.join(moduleDirectory,'module','operations.mjs')).href);
  assert.equal(typeof imported.previewCatalogProduct,'function');
  return {root,case:{composition:loaded.composition,lock:loaded.lock,
    modules:loaded.located.map(item=>item.descriptor)},handler:imported.previewCatalogProduct,
    moduleDirectory,receiptPath,cart,inventory};
}
