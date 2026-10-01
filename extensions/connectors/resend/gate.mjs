import {runSuite} from './ci/run-suite.mjs';
const results=['backend','ui','api-mcp','widgets','package','docs'].map(runSuite);
console.log(JSON.stringify({profile:'t29-resend-source',results,
  limits:['No real provider send, webhook, or inbound attachment CDN qualified.']},null,2));
