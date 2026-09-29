import {runSuite} from './ci/run-suite.mjs';
const results=['backend','ui','api-mcp','widgets','package','docs'].map(runSuite);
console.log(JSON.stringify({profile:'t28-meili-source',results,limits:[
  'External GET access qualified separately; the composed module has not called a real Meili instance.',
  'Indexing, search and native global search are not supplied by this tranche.'
]},null,2));
