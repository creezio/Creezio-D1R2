import {runSuite} from './ci/run-suite.mjs';

const results=['backend','ui','api-mcp','widgets','package','docs'].map(runSuite);
console.log(JSON.stringify({profile:'t22-analytics-local',results,
  limits:['Automatic tracking, host request logs, endpoint registry and measured productivity require host ports.']},null,2));
