import {runSuite} from './ci/run-suite.mjs';

const results=['backend','ui','api-mcp','widgets','package','docs'].map(runSuite);
console.log(JSON.stringify({profile:'t21-pages-navigation-local',results,
  limits:['Module checks do not certify anonymous publication, a hosted Site or public media delivery.']},null,2));
