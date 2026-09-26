import {runSuite} from './ci/run-suite.mjs';
const results=['backend','ui','api-mcp','widgets','package','docs'].map(runSuite);
console.log(JSON.stringify({profile:'access-contracts-local',results,limits:['Native HTTP transport is qualified separately by core tests; this gate does not qualify UI, MCP, hosted account flow or archive publication']},null,2));
