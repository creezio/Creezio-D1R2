import {runSuite} from './ci/run-suite.mjs';
const results=['backend','ui','api-mcp','widgets','package','docs'].map(runSuite);
console.log(JSON.stringify({profile:'t29-resend-source',results,
  limits:['No real provider send or webhook qualified; inbound attachments need a bounded private R2 ingest port.']},null,2));
