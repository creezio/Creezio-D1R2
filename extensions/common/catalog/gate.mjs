import {runSuite} from './ci/run-suite.mjs';

const results=['backend','ui','api-mcp','widgets','package','docs'].map(runSuite);
console.log(JSON.stringify({profile:'t25-common-catalog-local',results,
  limits:['Private R2 product images are not a public storefront delivery port.']},null,2));
