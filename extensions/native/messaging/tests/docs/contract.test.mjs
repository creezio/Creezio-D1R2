import test from 'node:test';
import assert from 'node:assert/strict';
import {manifest, read} from '../helpers.mjs';

test('messaging documents belong to the installed module and describe transport limits', () => {
  assert.equal(manifest.documentation.versionBinding.moduleVersion, manifest.identity.version);
  assert.equal(manifest.documentation.versionBinding.sourceRevision, manifest.identity.source.revision);
  for (const name of ['README.md', 'AGENTS.md', 'FILES.md', 'prd.md', 'interview.md', 'TODO.md', 'CHANGELOG.md'])
    assert.ok(read(name).trim().length > 80, name);
  const readme = read('README.md');
  assert.match(readme, /transport/i);
  assert.match(readme, /indisponible|unavailable/i);
  assert.match(read('prd.md'), /REQ-1801|T-18|T18/);
  assert.match(read('TODO.md'), /transport|fournisseur/i);
});
