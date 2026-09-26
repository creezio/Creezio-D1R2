import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Fixed repository: this reader cannot be used to send a credential to arbitrary hosts.
const repository = 'creezio/Creezio-D1R2';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let credential = process.env.GITHUB_TOKEN;
if (!credential) {
  const lines = execFileSync('git', ['credential', 'fill'], {
    input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
  });
  credential = lines.split(/\r?\n/).find(line => line.startsWith('password='))?.slice(9);
}
if (!credential) throw new Error('No GitHub credential available; no observation performed');
const headers = { Authorization: `Bearer ${credential}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
const endpoints = {
  repository: '', collaborators: '/collaborators?per_page=100', main: '/branches/main',
  protection: '/branches/main/protection', rulesets: '/rulesets?per_page=100',
  actionsPermissions: '/actions/permissions/workflow', workflows: '/actions/workflows?per_page=100'
};
const results = {};
for (const [name, suffix] of Object.entries(endpoints)) {
  const response = await fetch(`https://api.github.com/repos/${repository}${suffix}`, {
    method: 'GET', headers, redirect: 'error', signal: AbortSignal.timeout(20000)
  });
  const body = await response.json();
  // All selected endpoints contain metadata only, never secrets or credential responses.
  results[name] = { httpStatus: response.status, complete: !response.headers.get('link')?.includes('rel="next"'), body };
}
delete headers.Authorization;
credential = undefined;
const report = { schemaVersion: 1, repository, observedAt: new Date().toISOString(),
  scope: 'Read-only raw observations; not a normalized governance approval', mergeReady: false, results };
mkdirSync(resolve(root, '.quality'), { recursive: true });
writeFileSync(resolve(root, '.quality/github-observed.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ repository, mergeReady: false,
  endpoints: Object.fromEntries(Object.entries(results).map(([name,r]) => [name,{httpStatus:r.httpStatus,complete:r.complete}])),
  evidence: '.quality/github-observed.json' }, null, 2));
if (Object.values(results).some(r => r.httpStatus !== 200 && r.httpStatus !== 404)) process.exitCode = 1;
