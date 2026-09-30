import {runSuite} from './ci/run-suite.mjs';
const results=['backend','ui','api-mcp','widgets','package','docs'].map(runSuite);
console.log(JSON.stringify({profile:'t29-hermes-external-source',results,limits:['Real Hermes instance and runs not yet qualified.']},null,2));
