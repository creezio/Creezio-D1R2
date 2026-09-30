import {runSuite} from './ci/run-suite.mjs';

const results=['backend','ui','api-mcp','widgets','package','docs'].map(runSuite);
console.log(JSON.stringify({profile:'t21-pages-navigation-local',results,
  limits:['Module checks alone do not certify the host SSR/media adapter or a hosted Site.']},null,2));
