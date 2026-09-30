import '../../scripts/local-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {Miniflare} from 'miniflare';
import {validateComposition,validateCompositionTransition} from '../../sdk/contracts/validate.mjs';
import {namedModule,compositionCase,lockFor,accepted,refused} from '../contracts/helpers.mjs';
import {generateD1Schema} from '../../scripts/data/d1-schema.mjs';
import {compileOperationSchemas} from '../../scripts/operations/schemas.mjs';
import {OPERATION_MODELS,OPERATION_STORAGE_MODULE_ID} from '../../core/operations/models.ts';
import {ACCESS_TABLES} from '../../core/identity/d1-store.ts';
import {createAccountService,provisionBootstrapCapability} from '../../core/identity/accounts.ts';
import {createOperationRegistry} from '../../core/operations/registry.ts';
import {createOperationEngine} from '../../core/operations/service.ts';
import * as catalogHandlers from '../../extensions/common/catalog/module/operations.ts';
import {verifyPackageReceipt} from '../../scripts/modules/package-receipt.mjs';
import {loadRuntimeComposition} from '../../scripts/build/compose-runtime.mjs';
import {contractIntegrity} from '../../sdk/contracts/validate.mjs';
import {installedConsumerPackage} from './consumer-package.mjs';

const json=path=>JSON.parse(readFileSync(new URL(path,import.meta.url),'utf8'));
const access=json('../../extensions/native/access/module/manifest.json');
const catalog=json('../../extensions/common/catalog/module/manifest.json');
const catalogId='creezio.catalog',cartId='merchant.cart';

/** Specialize the existing merchant.cart contract fixture, keeping its public query boundary. */
function installedCase(){
  const cart=namedModule(cartId,'merchant');
  cart.compatibility.core='^0.0.0';
  cart.compatibility.sdk='^1.7.0';
  cart.validation.policy=structuredClone(access.validation.policy);
  cart.dependencies=[{moduleId:catalogId,origin:catalog.identity.origin,versionRange:'^0.1.0',
    optional:false,contracts:[{id:'catalog.products',versionRange:'^1.0.0'}],
    whenAbsent:'block',whenIncompatible:'block',autoInstall:false}];
  cart.contracts.schemas.push({id:'catalog-preview-input',schema:{type:'object',properties:{
    id:{type:'string',minLength:1,maxLength:128}},required:['id'],additionalProperties:false}});
  cart.contracts.schemas.push({id:'catalog-preview-output',schema:{type:'object',properties:{
    productId:{type:'string',minLength:1,maxLength:128},name:{type:'string',minLength:1,maxLength:160},
    priceMinor:{type:'integer',minimum:0},currency:{type:'string',pattern:'^[A-Z]{3}$'},
    revision:{type:'integer',minimum:1}},
  required:['productId','name','priceMinor','currency','revision'],additionalProperties:false}});
  const preview=cart.contracts.operations.find(item=>item.id==='get');
  preview.title='Preview a published catalog product';
  preview.input={schemaId:'catalog-preview-input'};
  preview.output={schemaId:'catalog-preview-output'};
  preview.handler={path:'module/operations.mjs',export:'previewCatalogProduct'};
  cart.packaging.runtime.files.push('package.json','module/operations.mjs');
  preview.effects.reads=[];
  preview.effects.calls=[{moduleId:catalogId,kind:'operation',id:'product.get'}];
  Object.assign(cart.contracts.api.find(item=>item.operation.id==='get'),{
    input:preview.input,output:preview.output});
  Object.assign(cart.contracts.mcp.tools.find(item=>item.operation.id==='get'),{
    input:preview.input,output:preview.output});
  cart.contracts.widgets.flatMap(item=>item.actions)
    .filter(item=>item.target.operation?.id==='get').forEach(item=>{item.input=preview.input;});
  const value=compositionCase([access,catalog,cart]);
  value.composition.sdk.version='1.7.0';
  value.composition.sdk.coreVersion='0.0.0';
  value.composition.sdk.policy=structuredClone(access.validation.policy);
  value.composition.modules.forEach((selection,index)=>{
    selection.versionRange=index===1?'^0.1.0':index===0?'^0.0.0':'^1.0.0';
  });
  value.lock=lockFor(value.composition,value.modules);
  return value;
}
function without(value,id){
  value.modules=value.modules.filter(item=>item.identity.id!==id);
  value.composition.modules=value.composition.modules.filter(item=>item.moduleId!==id);
  for(const audience of ['admin','app'])value.composition.exposure[audience].moduleIds=
    value.composition.exposure[audience].moduleIds.filter(item=>item!==id);
  value.lock=lockFor(value.composition,value.modules);
}
async function selectedRegistry(installed,consumerHandler){
  const compiled=compileOperationSchemas(installed);
  const validators={...await import(`data:text/javascript;base64,${Buffer.from(compiled.validatorsCode).toString('base64')}`)};
  const handlers=Object.fromEntries(catalog.contracts.operations.map(operation=>[
    `${catalogId}:${operation.id}`,catalogHandlers[operation.handler.export]]));
  handlers[`${cartId}:get`]=consumerHandler;
  for(const module of compiled.catalog.modules)for(const entry of module.operations)
    if(entry.active&&!Object.hasOwn(handlers,`${module.moduleId}:${entry.operation.id}`))
      handlers[`${module.moduleId}:${entry.operation.id}`]=()=>{throw new Error('Uncalled fixture operation');};
  return createOperationRegistry({catalog:compiled.catalog,validators,handlers});
}

test('installed merchant.cart consumes catalog.products and blocks removal, disablement and incompatible versions',
  {timeout:90000},async t=>{
    const installed=installedCase();
    accepted(validateComposition(installed.composition,{modules:installed.modules,lock:installed.lock}));
    for(const change of [
      value=>without(value,catalogId),
      value=>{value.composition.modules.find(item=>item.moduleId===catalogId).enabled=false;
        for(const audience of ['admin','app'])value.composition.exposure[audience].moduleIds=
          value.composition.exposure[audience].moduleIds.filter(item=>item!==catalogId);
        value.lock=lockFor(value.composition,value.modules);},
      value=>{value.modules.find(item=>item.identity.id===catalogId).contracts.publicContracts[0].version='2.0.0';
        value.lock=lockFor(value.composition,value.modules);},
    ]){
      const changed=structuredClone(installed);change(changed);
      refused(validateComposition(changed.composition,{modules:changed.modules,lock:changed.lock}),/^dependency\./);
      refused(validateCompositionTransition(installed.composition,changed.composition,{before:{
        modules:installed.modules,lock:installed.lock},after:{modules:changed.modules,lock:changed.lock}}),
      /^dependency\./);
    }

    const packageHost=await installedConsumerPackage(t,installed,new URL('./consumer-handler.mjs',import.meta.url));
    const loaded=packageHost.case;
    assert.equal(loaded.modules.at(-1).contracts.operations.find(item=>item.id==='get').handler.path,
      'module/operations.mjs');
    const changedFile=path.join(packageHost.moduleDirectory,'README.md');
    const originalReadme=readFileSync(changedFile);
    writeFileSync(changedFile,'Altered after extraction\n');
    assert.throws(()=>verifyPackageReceipt({root:packageHost.root,receiptPath:packageHost.receiptPath,
      moduleDirectory:packageHost.moduleDirectory,descriptor:packageHost.cart}),{code:'installed_runtime'});
    writeFileSync(changedFile,originalReadme);
    assert.doesNotThrow(()=>verifyPackageReceipt({root:packageHost.root,
      receiptPath:packageHost.receiptPath,moduleDirectory:packageHost.moduleDirectory,
      descriptor:packageHost.cart}));
    const compositionFile=path.join(packageHost.root,'configuration','composition.json');
    const lockFile=path.join(packageHost.root,'configuration','composition.lock.json');
    const catalogFile=path.join(packageHost.root,'extensions','common','catalog','module','manifest.json');
    const originalComposition=readFileSync(compositionFile);
    const originalLock=readFileSync(lockFile);
    const originalCatalog=readFileSync(catalogFile);
    const hostRefuses=code=>assert.throws(()=>loadRuntimeComposition({root:packageHost.root}),
      error=>error.code==='composition.invalid'&&error.diagnostics.some(item=>item.code===code));
    try{
      const missing=structuredClone(loaded.composition),missingLock=structuredClone(loaded.lock);
      missing.modules=missing.modules.filter(item=>item.moduleId!==catalogId);
      for(const audience of ['admin','app'])missing.exposure[audience].moduleIds=
        missing.exposure[audience].moduleIds.filter(item=>item!==catalogId);
      missingLock.modules=missingLock.modules.filter(item=>item.moduleId!==catalogId);
      missingLock.compositionIntegrity=contractIntegrity(missing);
      writeFileSync(compositionFile,`${JSON.stringify(missing)}\n`);
      writeFileSync(lockFile,`${JSON.stringify(missingLock)}\n`);
      hostRefuses('dependency.missing');
      writeFileSync(compositionFile,originalComposition);
      const incompatible=structuredClone(catalog),incompatibleLock=structuredClone(loaded.lock);
      incompatible.contracts.publicContracts[0].version='2.0.0';
      incompatibleLock.modules.find(item=>item.moduleId===catalogId).contractIntegrity=
        contractIntegrity(incompatible);
      writeFileSync(catalogFile,`${JSON.stringify(incompatible)}\n`);
      writeFileSync(lockFile,`${JSON.stringify(incompatibleLock)}\n`);
      hostRefuses('dependency.contract-version');
    }finally{
      writeFileSync(compositionFile,originalComposition);
      writeFileSync(lockFile,originalLock);
      writeFileSync(catalogFile,originalCatalog);
    }

    const runtime=new Miniflare({host:'127.0.0.1',port:0,cf:false,modules:true,
      compatibilityDate:'2026-05-15',script:'export default {fetch(){return new Response(null,{status:404})}}',
      d1Databases:{DB:'creezio-catalog-consumer'},d1Persist:false});
    try{
      const db=await runtime.getD1Database('DB');
      const catalogSchema=generateD1Schema(catalogId,catalog.contracts.models);
      const cartSchema=generateD1Schema(cartId,loaded.modules.at(-1).contracts.models);
      const accessSchema=generateD1Schema('creezio.access',json('../../extensions/native/access/module/models.json'));
      const technical=generateD1Schema(OPERATION_STORAGE_MODULE_ID,OPERATION_MODELS);
      await db.batch([...accessSchema.statements,...technical.statements,...catalogSchema.statements,
        ...cartSchema.statements]
        .map(sql=>db.prepare(sql)));
      const accounts=createAccountService(db),bootstrap=await provisionBootstrapCapability(db);
      const owner=await accounts.bootstrap({token:bootstrap.token,loginIdentifier:'cart@example.invalid',
        displayName:'Cart fixture owner',password:'Synthetic cart fixture password'});
      assert.equal(owner.ok,true);
      const admin=await accounts.login({loginIdentifier:'cart@example.invalid',
        password:'Synthetic cart fixture password',audience:'admin'});
      assert.equal(admin.ok,true);
      for(const id of [`${catalogId}:manage`,`${catalogId}:view`,`${cartId}:read`])
        await db.prepare(`INSERT INTO "${ACCESS_TABLES.role_grants}" (role_id,permission_id) VALUES (?,?)`)
          .bind('administrator',id).run();
      const permissions=[...catalog.contracts.permissions.map(item=>({id:`${catalogId}:${item.id}`,
        audiences:item.audiences,actors:item.actors})),...loaded.modules.at(-1).contracts.permissions.map(item=>({
        id:`${cartId}:${item.id}`,audiences:item.audiences,actors:item.actors}))];
      const modules=[catalog,loaded.modules.at(-1)];
      const registry=await selectedRegistry(loaded,packageHost.handler);
      const dataCatalog={schemaVersion:1,compositionDigest:registry.compositionDigest,modules:modules.map(module=>({
        moduleId:module.identity.id,version:module.identity.version,enabled:true,
        permissions:module.contracts.permissions,models:module.contracts.models.map(model=>({
          modelId:model.id,table:(module.identity.id===catalogId?catalogSchema:cartSchema).tables[model.id],
          model}))}))};
      const engine=createOperationEngine({db,catalog:dataCatalog,registry,permissions});
      const invoke=(moduleId,operationId,input)=>engine.invoke({credential:{kind:'session',token:admin.token},
        moduleId,operationId,contextId:'application',audience:'admin',input});
      const fields={sku:'CART-001',name:'Produit consommé',description:'Fixture',attributes:[],
        categoryId:null,priceMinor:1299,currency:'EUR'};
      const created=await invoke(catalogId,'product.create',{requestKey:'cart-create',...fields});
      assert.equal(created.execution.state,'succeeded',JSON.stringify(created));
      const product=created.execution.output.product;
      const published=await invoke(catalogId,'product.publish',{requestKey:'cart-publish',id:product.id,
        revision:product.revision});
      assert.equal(published.execution.state,'succeeded',JSON.stringify(published));
      const preview=await invoke(cartId,'get',{id:product.id});
      assert.equal(preview.execution.state,'succeeded',JSON.stringify(preview));
      assert.deepEqual({...preview.execution.output},{productId:product.id,name:fields.name,
        priceMinor:1299,currency:'EUR',revision:published.execution.output.product.revision});
      const repriced=await invoke(catalogId,'product.update',{requestKey:'cart-reprice',id:product.id,
        revision:published.execution.output.product.revision,...fields,priceMinor:1499});
      assert.equal(repriced.execution.state,'succeeded',JSON.stringify(repriced));
      const fresh=await invoke(cartId,'get',{id:product.id});
      assert.equal(fresh.execution.state,'succeeded',JSON.stringify(fresh));
      assert.equal(fresh.execution.output.priceMinor,1499);
      assert.equal(fresh.execution.output.revision,repriced.execution.output.product.revision);
      await db.prepare(`DELETE FROM "${ACCESS_TABLES.role_grants}" WHERE role_id='administrator' AND permission_id=?`)
        .bind(`${catalogId}:view`).run();
      const denied=await invoke(cartId,'get',{id:product.id});
      assert.notEqual(denied.execution?.state,'succeeded');
      assert.equal(denied.code??denied.execution?.errorCode,'forbidden');
    }finally{await runtime.dispose();}
  });
