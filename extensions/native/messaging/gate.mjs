import {runSuite} from './ci/run-suite.mjs';

const results = ['backend', 'ui', 'api-mcp', 'widgets', 'package', 'docs'].map(runSuite);
console.log(JSON.stringify({profile: 't18-messaging-local', results,
  limits: ['Module checks do not certify a real email provider, browser recipe or hosted deployment.']}, null, 2));
