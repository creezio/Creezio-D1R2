import {runSuite} from './ci/run-suite.mjs';
const results=['backend','ui','api-mcp','widgets','package','docs'].map(runSuite);
console.log(JSON.stringify({profile:'t13-chatgpt-like-theme',results,limits:['Theme contract tests only; composition, browser, access and hosted delivery require host qualification']},null,2));
