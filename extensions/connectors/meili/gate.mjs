import {runSuite} from './ci/run-suite.mjs';
const results=['backend','ui','api-mcp','widgets','package','docs'].map(runSuite);
console.log(JSON.stringify({profile:'t28-meili-source',results,limits:[
  'External GET access was qualified separately; the first real document task (165) failed with ambiguous primary-key detection and indexed zero documents.',
  'The primaryKey=id correction and widget are locally tested; a distinct real provider task and search still need qualification. Native global search T05 remains deferred.'
]},null,2));
