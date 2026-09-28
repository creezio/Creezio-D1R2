import test from 'node:test';
import assert from 'node:assert/strict';
import {manifest,read} from '../helpers.mjs';

test('catalog documentation names limits and six-suite validation',()=>{
  for(const file of ['README.md','prd.md','AGENTS.md','FILES.md','interview.md','TODO.md','CHANGELOG.md'])
    assert.ok(read(file).trim().length>100,file);
  const readme=read('README.md');
  assert.match(readme,/catalog\.products@1\.0\.0/u);
  assert.match(readme,/R2/u);
  assert.match(readme,/widgets/u);
  assert.match(read('TODO.md'),/image/u);
  for(const suite of ['backend','ui','api-mcp','widgets','package','docs'])
    assert.equal(manifest.validation.suites[suite].tests.length,1);
});
