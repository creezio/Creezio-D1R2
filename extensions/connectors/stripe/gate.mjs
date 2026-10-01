import {runSuite} from './ci/run-suite.mjs';
const results=['backend','ui','api-mcp','widgets','package','docs'].map(runSuite);
console.log(JSON.stringify({profile:'t27-stripe-source',results,
  limits:['Subscription cancellation reversal 0.4.0 requires provider qualification; signed webhook redelivery and historical unknown outcomes remain unqualified.']},null,2));
