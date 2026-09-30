import {runSuite} from './ci/run-suite.mjs';

const results=['backend','ui','api-mcp','widgets','package','docs'].map(runSuite);
console.log(JSON.stringify({profile:'t22-analytics-local',results,
  limits:['Hosted browser and transport acceptance remain to be run after central integration.',
    'Measured Work productivity, heartbeats and full request logs remain out of scope.',
    'Pre-engine refusal diagnostics are bounded, off by default and purged only on explicit admin command.']},null,2));
