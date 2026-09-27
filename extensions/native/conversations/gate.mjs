import {runSuite} from './ci/run-suite.mjs';
const results=['backend','ui','api-mcp','widgets','package','docs'].map(runSuite);
console.log(JSON.stringify({profile:'t14-conversations-local',results,
  limits:['Browser, Sites and a real LLM provider require separate recipes.']},null,2));
