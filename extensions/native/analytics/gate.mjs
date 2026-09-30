import {runSuite} from './ci/run-suite.mjs';

const results=['backend','ui','api-mcp','widgets','package','docs'].map(runSuite);
console.log(JSON.stringify({profile:'t22-analytics-local',results,
  limits:['Automatic tracking, pre-engine HTTP/MCP request logs and measured Work productivity remain open.',
    'Compiled HTTP endpoints and the existing operation journal are read-only admin diagnostics.']},null,2));
