import {runSuite} from './ci/run-suite.mjs';

const results = ['backend', 'ui', 'api-mcp', 'widgets', 'package', 'docs'].map(runSuite);
console.log(JSON.stringify({profile: 't32-local-delivery', results,
  limits: ['A real Docker local to Cloudflare publication requires the native host and operator.']}, null, 2));
