import {runSuite} from './ci/run-suite.mjs';
const results=['backend','ui','api-mcp','widgets','package','docs'].map(runSuite);
console.log(JSON.stringify({profile:'modules-settings-local',results,limits:['Hosted publication and external distribution require their own recipes.']},null,2));
