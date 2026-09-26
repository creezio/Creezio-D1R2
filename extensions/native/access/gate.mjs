import {runSuite} from './ci/run-suite.mjs';
const results=['backend','ui','api-mcp','widgets','package','docs'].map(runSuite);
console.log(JSON.stringify({profile:'access-storage-local',results,limits:['No HTTP, UI, MCP, hosted account flow or archive publication qualification']},null,2));
