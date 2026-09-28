import {runSuite} from './ci/run-suite.mjs';
const results=['backend','ui','api-mcp','widgets','package','docs'].map(runSuite);
console.log(JSON.stringify({profile:'t26-n8n-source',results,limits:['Real n8n instance not yet qualified.']},null,2));
