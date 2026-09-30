import {runSuite} from './ci/run-suite.mjs';
const results=['backend','ui','api-mcp','widgets','package','docs'].map(runSuite);
console.log(JSON.stringify({profile:'t28-meili-source',results,limits:[
  'External GET access qualified separately; the composed module has not called a real Meili instance.',
  'Projection and widget are locally tested; provider writes, tasks and search need a separate real instance recipe. Native global search T05 remains deferred.'
]},null,2));
