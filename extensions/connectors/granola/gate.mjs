import {runSuite} from './ci/run-suite.mjs';
const results=['backend','ui','api-mcp','widgets','package','docs'].map(runSuite);
console.log(JSON.stringify({profile:'t29-granola-source',results,
  limits:['Supplier-account and signed webhook receipt on a hosted target remain separate delivery evidence.']},null,2));
