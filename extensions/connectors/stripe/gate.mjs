import {runSuite} from './ci/run-suite.mjs';
const results=['backend','ui','api-mcp','widgets','package','docs'].map(runSuite);
console.log(JSON.stringify({profile:'t27-stripe-source',results,
  limits:['Test payment was confirmed on 0.3.0; webhook 0.3.1 is locally qualified but not delivered or reconciled with the historical event.']},null,2));
