import test from 'node:test';
import assert from 'node:assert/strict';
import {manifest,read} from '../helpers.mjs';

test('version-bound documents distinguish original UI from new CRM entities and limits',()=>{
  assert.equal(manifest.documentation.versionBinding.moduleVersion,manifest.identity.version);
  assert.match(read('prd.md'),/original/);
  assert.match(read('README.md'),/500 lignes/);
  assert.match(read('TODO.md'),/ports publics versionnés/);
  assert.match(read('CHANGELOG.md'),/Aucune release/);
});
