import {runSuite} from './ci/run-suite.mjs';
const results=['backend','ui','api-mcp','widgets','package','docs'].map(runSuite);
console.log(JSON.stringify({profile:'t15-openai-local',results,
  limits:['A real provider call and browser/Sites recipes are separate from this module gate.']},null,2));
