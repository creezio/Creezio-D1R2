import {runSuite} from './ci/run-suite.mjs';

const results=['backend','ui','api-mcp','widgets','package','docs'].map(runSuite);
console.log(JSON.stringify({profile:'t25-common-catalog-local',results,
  limits:['Linked images require an authenticated app viewer and a published product; anonymous and external widget delivery remain open.']},null,2));
