import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import {validateModule} from '../../sdk/contracts/validate.mjs';
import {fixture,accepted,refused} from './helpers.mjs';

const common=JSON.parse(readFileSync(new URL('../../sdk/contracts/schemas/v1/common.schema.json',import.meta.url),'utf8'));
const ajv=addFormats(new Ajv2020({strict:true}));ajv.addSchema(common);
const field=ajv.getSchema('urn:creezio:contracts:v1:common#/$defs/fieldName');
const exported=ajv.getSchema('urn:creezio:contracts:v1:common#/$defs/exportName');
test('JSON field references and static exports have distinct syntax from contract identifiers',()=>{
  for(const value of ['principalId','requestKey','beforeCreatedAtMs','record_version','record-version','record.version'])assert.equal(field(value),true,value);
  for(const value of ['__proto__','prototype','constructor','a/b','a b','a'.repeat(129)])assert.equal(field(value),false,value);
  for(const value of ['AccessAdminView','hostOnly','_private','$component'])assert.equal(exported(value),true,value);
  for(const value of ['object.method','x-y','run()','a;execute','1handler','x'.repeat(129)])assert.equal(exported(value),false,value);
});
test('real module commands can use camelCase idempotency/version fields and exported React names',()=>{
  const module=fixture(), schema=module.contracts.schemas.find(item=>item.id==='update-input').schema;
  const replacements={request_id:'requestKey',record_version:'expectedVersion'};
  for(const [oldName,newName]of Object.entries(replacements)) {
    schema.properties[newName]=schema.properties[oldName];delete schema.properties[oldName];
    schema.required=schema.required.map(name=>name===oldName?newName:name);
  }
  for(const operation of module.contracts.operations) {
    if(operation.idempotency.mode==='required')operation.idempotency.keyField='requestKey';
    if(operation.concurrency.mode==='object-version')operation.concurrency.versionField='expectedVersion';
    operation.handler.export='runOperation';
  }
  module.contracts.ui.views[0].component.export='NativeModuleView';
  accepted(validateModule(module));
  module.contracts.operations[0].id='InvalidContractId';
  refused(validateModule(module),'schema.invalid');
});
