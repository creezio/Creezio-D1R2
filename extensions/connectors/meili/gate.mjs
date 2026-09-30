import {runSuite} from './ci/run-suite.mjs';
const results=['backend','ui','api-mcp','widgets','package','docs'].map(runSuite);
console.log(JSON.stringify({profile:'t28-meili-source',results,limits:[
  'External GET access qualified separately; the composed module has not called a real Meili instance.',
  'Index diagnostics are admin-only; indexing, document search and native global search are not supplied.'
]},null,2));
