import {runSuite} from './ci/run-suite.mjs';
const results=['backend','ui','api-mcp','widgets','package','docs'].map(runSuite);
console.log(JSON.stringify({profile:'t27-stripe-source',results,
  limits:['App offer Checkout 0.5.0 requires Stripe TEST provider qualification; historical unknown webhook outcomes remain unqualified.']},null,2));
