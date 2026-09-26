import {runSuite} from './ci/run-suite.mjs';
const results=['backend','ui','api-mcp','widgets','package','docs'].map(runSuite);
console.log(JSON.stringify({profile:'module-witness-local',results,limits:['No hosted runtime, authentication, MCP or archive publication proof']},null,2));
