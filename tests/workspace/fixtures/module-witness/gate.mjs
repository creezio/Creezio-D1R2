import {runSuite} from './ci/run-suite.mjs';
const results=['backend','ui','api-mcp','widgets','package','docs'].map(runSuite);
console.log(JSON.stringify({profile:'workspace-witness-local',results,
  limits:['Contract and component tests only; browser, real D1 mutation, hosted runtime and archive publication require separate proof']},null,2));
