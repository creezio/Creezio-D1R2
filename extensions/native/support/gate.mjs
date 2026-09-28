import {runSuite} from './ci/run-suite.mjs';
const results=['backend','ui','api-mcp','widgets','package','docs'].map(runSuite);
console.log(JSON.stringify({profile:'t19-support-module-local',results,
  limits:['Host composition, browser, API and live MCP recipes are separate integration work.']},null,2));
