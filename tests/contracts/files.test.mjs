import test from 'node:test';
import { validateModule } from '../../sdk/contracts/validate.mjs';
import { fixture, accepted, refused } from './helpers.mjs';

test('file storage mapping is explicit and its metadata remains private and scoped', () => {
  const positive = fixture();
  accepted(validateModule(positive));
  for (const ownerScope of ['principal', 'principal-audience']) {
    const withScope = structuredClone(positive);
    withScope.contracts.files[0].ownerScope = ownerScope;
    accepted(validateModule(withScope));
  }
  const cases = [
    ['unknown owner scope', file => { file.ownerScope = 'session'; }, 'schema.invalid'],
    ['missing mapping', (file) => { delete file.storageFields; }, 'schema.invalid'],
    ['aliased storage fields', file => { file.storageFields.digest = file.storageFields.objectKey; }, /^file\./],
    ['public metadata', (file, model) => { model.public = true; }, /^file\./],
    ['client-editable object key', (file, model) => {
      model.fields.find(field => field.id === file.storageFields.objectKey).protected = false;
    }, /^file\./],
    ['text size', (file, model) => {
      model.fields.find(field => field.id === file.storageFields.byteSize).type = 'string';
    }, /^file\./],
    ['nullable owner', (file, model) => {
      model.fields.find(field => field.id === file.ownerField).nullable = true;
    }, /^file\./],
    ['unbounded state', (file, model) => {
      delete model.fields.find(field => field.id === file.storageFields.state).constraints;
    }, /^file\./],
    ['no unique intent', (file, model) => {
      model.indexes = model.indexes.filter(index => !index.fields.includes(file.storageFields.intentId));
    }, /^file\./],
  ];
  for (const [name, mutate, expected] of cases) {
    const module = structuredClone(positive);
    const file = module.contracts.files[0];
    const model = module.contracts.models.find(model => model.id === file.metadataModel.id);
    mutate(file, model);
    const result = validateModule(module);
    try { refused(result, expected); } catch (error) { error.message = `${name}: ${error.message}`; throw error; }
  }
});
