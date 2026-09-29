import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {contractIntegrity} from '../../sdk/contracts/validate.mjs';
import {providerOutputDescription} from '../../scripts/build/provider-output-description.mjs';
import {projectAuthorizedReadTools} from '../../core/providers/tools.ts';

const manifest=JSON.parse(readFileSync(new URL('../../extensions/common/catalog/module/manifest.json',import.meta.url),'utf8'));
const operations=manifest.contracts.operations.filter(operation=>
  ['product.search','product.get'].includes(operation.id));
const schemas=manifest.contracts.schemas;
const schema=ref=>schemas.find(item=>item.id===ref.schemaId)?.schema;

test('Catalogue provider tools distinguish the search SKU from the internal get ID',async()=>{
  assert.equal(operations.length,2);
  const catalog=operations.map(operation=>{
    const inputSchema=schema(operation.input),outputSchema=schema(operation.output);
    assert.ok(inputSchema&&outputSchema,operation.id);
    return {moduleId:'creezio.catalog',operationId:operation.id,inputSchema,
      schemaDigest:contractIntegrity(inputSchema),audiences:['app'],
      outputDescription:providerOutputDescription(outputSchema)};
  });
  const projected=await projectAuthorizedReadTools({catalog,
    registry:{resolve(moduleId,operationId){
      assert.equal(moduleId,'creezio.catalog');
      return {declaration:operations.find(operation=>operation.id===operationId)};
    }},
    data:{async authorize(){return {};},dispose(){}},
    request:{credential:{kind:'session',token:'opaque'},contextId:'application',audience:'app'}});
  assert.deepEqual(projected.diagnostics,[]);
  assert.equal(projected.tools.length,2);
  const search=projected.tools.find(tool=>tool.operationId==='product.search')?.provider;
  const get=projected.tools.find(tool=>tool.operationId==='product.get')?.provider;
  assert.ok(search&&get);
  assert.match(search.parameters.properties.query.description,/name or SKU/);
  assert.match(search.parameters.properties.query.description,/items\[\]\.id/);
  assert.match(search.description,/items\[\]\.id: Internal product ID, not SKU/);
  assert.match(get.parameters.properties.id.description,/Internal product ID, never SKU/);
  assert.match(get.parameters.properties.id.description,/items\[\]\.id from product\.search/);
  assert.deepEqual(Object.keys(get.parameters.properties),['id']);
  assert.equal(get.parameters.properties.id.maxLength,36);
});
