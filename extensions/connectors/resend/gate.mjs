import {runSuite} from './ci/run-suite.mjs';
const results=['backend','ui','api-mcp','widgets','package','docs'].map(runSuite);
console.log(JSON.stringify({profile:'t29-resend-source',results,
  limits:['No real send or webhook qualified; Messaging outbox and R2 attachments remain to connect.']},null,2));
