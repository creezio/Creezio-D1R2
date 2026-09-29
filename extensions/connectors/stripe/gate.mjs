import {runSuite} from './ci/run-suite.mjs';
const results=['backend','ui','api-mcp','widgets','package','docs'].map(runSuite);
console.log(JSON.stringify({profile:'t27-stripe-source',results,
  limits:['Stripe test reads observed separately; full T27 payment and webhook recipe remain open.']},null,2));
