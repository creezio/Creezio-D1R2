import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { validateGovernance as validateSnapshot } from '../../scripts/quality/governance.mjs';

// Deliberately synthetic identities/SHAs. These are test data, never a live report.
const sha = digit => digit.repeat(40);
const controller = { repository: 'example/policy', path: '.github/workflows/quality.yml', sha: sha('a') };
function policyFixture() {
  return { repository: 'example/project', reviewMode: 'independent-github', authorizedReviewerIds: [30, 40],
    gate: { name: 'creezio/quality-gate', appId: 100, controller: structuredClone(controller) } };
}
const validateGovernance = (snapshot, expectedPolicy = policyFixture()) => validateSnapshot(snapshot, expectedPolicy);
function fixture(phase = 'review') {
  return {
    schemaVersion: 1, phase, observedAt: '2026-09-26T12:00:00Z',
    repository: { complete: true, fullName: 'example/project', defaultBranch: 'main', mainSha: sha('b'),
      allowSquashMerge: true, allowMergeCommit: false, allowRebaseMerge: false },
    rules: { complete: true, branch: 'main', enforcement: 'active', requiredPullRequest: true,
      requiredApprovingReviews: 1, dismissStaleReviews: true, requireLastPushApproval: true,
      requireConversationResolution: true, requireUpToDateBranch: true, enforceAdmins: true,
      allowForcePushes: false, allowDeletions: false, bypassActors: [],
      requiredChecks: [{ name: 'creezio/quality-gate', appId: 100 }] },
    ...(phase === 'rules' ? {} : {
      pullRequest: { number: 7, state: 'open', draft: false, baseRepository: 'example/project',
        baseBranch: 'main', baseSha: sha('b'), headSha: sha('c'),
        author: { id: 10, login: 'contributor' },
        lastPush: { actor: { id: 20, login: 'maintainer' }, at: '2026-09-26T10:00:00Z', headSha: sha('c') } },
      comparison: { complete: true, baseSha: sha('b'), headSha: sha('c'), behindBy: 0 },
      reviews: { complete: true, items: [{ id: 70, reviewer: { id: 30, login: 'reviewer' },
        state: 'APPROVED', commitSha: sha('c'), submittedAt: '2026-09-26T11:00:00Z' }] },
      checks: { complete: true, items: [{ id: 80, name: 'creezio/quality-gate', appId: 100,
        status: 'completed', conclusion: 'success', headSha: sha('c'),
        source: { headSha: sha('c'), baseSha: sha('b') }, completedAt: '2026-09-26T11:15:00Z',
        controller: structuredClone(controller) }] },
      conversations: { complete: true, unresolvedCount: 0 },
    }),
  };
}
function rejects(snapshot, code, expectedPolicy = policyFixture()) {
  const { errors } = validateSnapshot(snapshot, expectedPolicy);
  assert.ok(errors.some(error => error.startsWith(`${code}:`)), `Expected ${code}, got ${JSON.stringify(errors)}`);
}

test('accepts explicit rules-only evidence without inventing a PR approval', () => {
  const snapshot = fixture('rules');
  assert.deepEqual(validateGovernance(snapshot), { errors: [] });
  snapshot.phase = 'review';
  rejects(snapshot, 'APPROVAL');
  rejects(snapshot, 'CHECK_MISSING');
});

test('accepts a current independent review and pinned successful gate without mutating evidence', () => {
  const snapshot = fixture();
  const original = structuredClone(snapshot);
  assert.deepEqual(validateGovernance(snapshot), { errors: [] });
  assert.deepEqual(snapshot, original);
});

test('accepts an explicitly identified merge candidate covering current head and base', () => {
  const snapshot = fixture();
  snapshot.pullRequest.mergeSha = sha('d');
  snapshot.checks.items[0].headSha = sha('d');
  assert.deepEqual(validateGovernance(snapshot), { errors: [] });
});

for (const value of [undefined, null, [], {}, true, 'success']) {
  test(`rejects absent or malformed snapshot: ${JSON.stringify(value)}`, () => {
    assert.ok(validateGovernance(value).errors.length);
  });
}

const badRules = [
  ['missing phase', s => { delete s.phase; }, 'PHASE'],
  ['unknown schema', s => { s.schemaVersion = 2; }, 'VERSION'],
  ['wrong repository', s => { s.repository.fullName = 'other/project'; }, 'REPOSITORY'],
  ['unknown rules', s => { delete s.rules; }, 'INCOMPLETE'],
  ['partial rules', s => { s.rules.complete = false; }, 'INCOMPLETE'],
  ['partial repository', s => { delete s.repository.complete; }, 'INCOMPLETE'],
  ['rules in evaluate mode', s => { s.rules.enforcement = 'evaluate'; }, 'ENFORCEMENT'],
  ['wrong branch', s => { s.rules.branch = 'develop'; }, 'BRANCH'],
  ['zero approvals', s => { s.rules.requiredApprovingReviews = 0; }, 'REVIEW_COUNT'],
  ['admin bypass', s => { s.rules.enforceAdmins = false; }, 'PROTECTION'],
  ['app bypass', s => { s.rules.bypassActors = [{ type: 'App', id: 100 }]; }, 'BYPASS'],
  ['unobserved bypasses', s => { delete s.rules.bypassActors; }, 'BYPASS'],
  ['missing check', s => { s.rules.requiredChecks = []; }, 'GATE_REQUIRED'],
  ['unpinned required App', s => { s.rules.requiredChecks[0].appId = -1; }, 'CHECK_ORIGIN'],
  ['wrong required App', s => { s.rules.requiredChecks[0].appId = 200; }, 'GATE_REQUIRED'],
  ['duplicate required name', s => { s.rules.requiredChecks.push({ ...s.rules.requiredChecks[0] }); }, 'CHECK_DUPLICATE'],
  ['merge commits enabled', s => { s.repository.allowMergeCommit = true; }, 'MERGE_METHOD'],
  ['rebase enabled', s => { s.repository.allowRebaseMerge = true; }, 'MERGE_METHOD'],
  ['squash unavailable', s => { s.repository.allowSquashMerge = false; }, 'MERGE_METHOD'],
];
for (const key of ['requiredPullRequest', 'dismissStaleReviews', 'requireLastPushApproval',
  'requireConversationResolution', 'requireUpToDateBranch']) {
  badRules.push([`${key} disabled`, s => { s.rules[key] = false; }, 'PROTECTION']);
  badRules.push([`${key} absent`, s => { delete s.rules[key]; }, 'PROTECTION']);
}
for (const key of ['allowForcePushes', 'allowDeletions']) {
  badRules.push([`${key} enabled`, s => { s.rules[key] = true; }, 'PROTECTION']);
  badRules.push([`${key} unknown`, s => { delete s.rules[key]; }, 'PROTECTION']);
}
for (const [name, mutate, code] of badRules) {
  test(`rules refuse ${name}`, () => { const snapshot = fixture('rules'); mutate(snapshot); rejects(snapshot, code); });
}

const badReview = [
  ['draft PR', s => { s.pullRequest.draft = true; }, 'PR_STATE'],
  ['closed PR', s => { s.pullRequest.state = 'closed'; }, 'PR_STATE'],
  ['old base', s => { s.repository.mainSha = sha('d'); }, 'PR_BASE'],
  ['behind main', s => { s.comparison.behindBy = 1; }, 'UP_TO_DATE'],
  ['comparison for another head', s => { s.comparison.headSha = sha('d'); }, 'UP_TO_DATE'],
  ['unknown comparison', s => { delete s.comparison.complete; }, 'UP_TO_DATE'],
  ['unresolved discussion', s => { s.conversations.unresolvedCount = 1; }, 'CONVERSATIONS'],
  ['partial discussions', s => { s.conversations.complete = false; }, 'CONVERSATIONS'],
  ['no approval', s => { s.reviews.items = []; }, 'APPROVAL'],
  ['partial reviews', s => { s.reviews.complete = false; }, 'INCOMPLETE'],
  ['author approval', s => { s.pullRequest.author = { ...s.reviews.items[0].reviewer }; }, 'APPROVAL'],
  ['pusher approval', s => { s.pullRequest.lastPush.actor = { ...s.reviews.items[0].reviewer }; }, 'APPROVAL'],
  ['same login with fabricated ID', s => { s.pullRequest.author.login = 'REVIEWER'; }, 'APPROVAL'],
  ['old approval commit', s => { s.reviews.items[0].commitSha = sha('d'); }, 'APPROVAL'],
  ['approval predating push', s => { s.reviews.items[0].submittedAt = '2026-09-26T09:00:00Z'; }, 'APPROVAL'],
  ['ambiguous same-second review', s => { s.reviews.items[0].submittedAt = s.pullRequest.lastPush.at; }, 'APPROVAL'],
  ['dismissed review', s => { s.reviews.items[0].state = 'DISMISSED'; }, 'APPROVAL'],
  ['pending review', s => { s.reviews.items[0].state = 'PENDING'; }, 'APPROVAL'],
  ['requested changes', s => { s.reviews.items[0].state = 'CHANGES_REQUESTED'; }, 'CHANGES_REQUESTED'],
  ['unknown last push identity', s => { delete s.pullRequest.lastPush.actor; }, 'INCOMPLETE'],
  ['wrong last pushed commit', s => { s.pullRequest.lastPush.headSha = sha('d'); }, 'PUSH'],
  ['missing check run', s => { s.checks.items = []; }, 'CHECK_MISSING'],
  ['partial check collection', s => { s.checks.complete = false; }, 'INCOMPLETE'],
  ['same-name check from other App', s => { s.checks.items[0].appId = 200; }, 'CHECK_MISSING'],
  ['old check commit', s => { s.checks.items[0].headSha = sha('d'); }, 'CHECK_SHA'],
  ['old composition', s => { s.checks.items[0].source.baseSha = sha('d'); }, 'CHECK_SHA'],
  ['missing controller evidence', s => { delete s.checks.items[0].controller; }, 'CHECK_CONTROLLER'],
  ['candidate-selected controller', s => { s.checks.items[0].controller.sha = sha('c'); }, 'CHECK_CONTROLLER'],
  ['same App, wrong controller path', s => { s.checks.items[0].controller.path = 'candidate/always-green.mjs'; }, 'CHECK_CONTROLLER'],
  ['check predating push', s => { s.checks.items[0].completedAt = '2026-09-26T09:00:00Z'; }, 'CHECK_TIME'],
  ['future check', s => { s.checks.items[0].completedAt = '2026-09-26T13:00:00Z'; }, 'CHECK_TIME'],
  ['invalid calendar timestamp', s => { s.observedAt = '2026-02-30T12:00:00Z'; }, 'TIME'],
];
for (const conclusion of ['skipped', 'neutral', 'cancelled', 'failure', 'timed_out', 'action_required', null]) {
  badReview.push([`non-success conclusion ${conclusion}`, s => { s.checks.items[0].conclusion = conclusion; }, 'CHECK_RESULT']);
}
for (const [name, mutate, code] of badReview) {
  test(`review refuses ${name}`, () => { const snapshot = fixture(); mutate(snapshot); rejects(snapshot, code); });
}

test('requires separate expected authority and ignores no policy failures', () => {
  assert.ok(validateSnapshot(fixture()).errors.length);
  assert.ok(validateSnapshot(fixture(), null).errors.length);
  for (const [mutate, code] of [
    [p => { p.gate.controller.sha = 'main'; }, 'ORIGIN'],
    [p => { delete p.gate.appId; }, 'ORIGIN'],
    [p => { p.gate.name = 'some-green-check'; }, 'GATE'],
    [p => { p.authorizedReviewerIds = []; }, 'REVIEWERS'],
    [p => { p.authorizedReviewerIds = [40]; }, 'APPROVAL'],
    [p => { delete p.reviewMode; }, 'REVIEW_MODE'],
    [p => { p.reviewMode = 'skip-review'; }, 'REVIEW_MODE'],
  ]) {
    const policy = policyFixture(); mutate(policy); rejects(fixture(), code, policy);
  }
});

function singleMaintainer() {
  const snapshot = fixture();
  const policy = policyFixture();
  policy.reviewMode = 'single-maintainer';
  policy.technicalReviewerRole = 'independent-agent';
  delete policy.authorizedReviewerIds;
  snapshot.rules.requiredApprovingReviews = 0;
  delete snapshot.rules.dismissStaleReviews;
  delete snapshot.rules.requireLastPushApproval;
  snapshot.pullRequest.lastPush.actor = { ...snapshot.pullRequest.author };
  delete snapshot.reviews;
  snapshot.reviewEvidence = { reviewerRole: 'independent-agent', decision: 'accepted',
    source: { headSha: sha('c'), baseSha: sha('b') }, reviewedAt: '2026-09-26T11:00:00Z' };
  return { snapshot, policy };
}

test('explicit single-maintainer mode uses independent technical evidence, not a second GitHub account', () => {
  const { snapshot, policy } = singleMaintainer();
  assert.deepEqual(validateSnapshot(snapshot, policy), { errors: [] });
  snapshot.rules.dismissStaleReviews = false;
  snapshot.rules.requireLastPushApproval = false;
  assert.deepEqual(validateSnapshot(snapshot, policy), { errors: [] });
  snapshot.phase = 'rules';
  delete snapshot.reviewEvidence;
  assert.deepEqual(validateSnapshot(snapshot, policy), { errors: [] });
});

const badTechnicalReview = [
  ['missing evidence', s => { delete s.reviewEvidence; }, 'INCOMPLETE'],
  ['unapproved role', s => { s.reviewEvidence.reviewerRole = 'implementer'; }, 'TECHNICAL_REVIEW_ROLE'],
  ['not accepted', s => { s.reviewEvidence.decision = 'changes-requested'; }, 'TECHNICAL_REVIEW_DECISION'],
  ['old head', s => { s.reviewEvidence.source.headSha = sha('d'); }, 'TECHNICAL_REVIEW_SHA'],
  ['old main', s => { s.reviewEvidence.source.baseSha = sha('d'); }, 'TECHNICAL_REVIEW_SHA'],
  ['before last push', s => { s.reviewEvidence.reviewedAt = '2026-09-26T09:00:00Z'; }, 'TECHNICAL_REVIEW_TIME'],
  ['future evidence', s => { s.reviewEvidence.reviewedAt = '2026-09-26T13:00:00Z'; }, 'TECHNICAL_REVIEW_TIME'],
  ['unobserved review time', s => { delete s.reviewEvidence.reviewedAt; }, 'TECHNICAL_REVIEW_TIME'],
  ['remote approval still required', s => { s.rules.requiredApprovingReviews = 1; }, 'REVIEW_COUNT'],
  ['self GitHub approval', s => { s.reviews = { complete: true, items: [{ state: 'APPROVED', reviewer: { ...s.pullRequest.author } }] }; }, 'SELF_APPROVAL'],
];
for (const [name, mutate, code] of badTechnicalReview) {
  test(`single-maintainer refuses ${name}`, () => {
    const { snapshot, policy } = singleMaintainer(); mutate(snapshot); rejects(snapshot, code, policy);
  });
}

test('single-maintainer authority cannot be chosen by snapshot or omit the expected technical role', () => {
  const { snapshot, policy } = singleMaintainer();
  const independentPolicy = policyFixture();
  snapshot.reviewMode = 'single-maintainer';
  rejects(snapshot, 'REVIEW_COUNT', independentPolicy);
  delete policy.technicalReviewerRole;
  rejects(snapshot, 'REVIEWERS', policy);
});

test('snapshot cannot choose its own expected App, controller or reviewer authority', () => {
  const snapshot = fixture();
  snapshot.policy = policyFixture();
  snapshot.policy.gate.appId = 200;
  snapshot.policy.gate.controller.sha = sha('c');
  snapshot.policy.authorizedReviewerIds = [10];
  snapshot.checks.items[0].appId = 200;
  snapshot.checks.items[0].controller.sha = sha('c');
  snapshot.rules.requiredChecks[0].appId = 200;
  snapshot.reviews.items[0].reviewer = { ...snapshot.pullRequest.author };
  rejects(snapshot, 'SNAPSHOT_POLICY');
  rejects(snapshot, 'GATE_REQUIRED');
  rejects(snapshot, 'APPROVAL');
});

test('malformed identity fields fail validation rather than throwing or proving independence', () => {
  for (const value of [null, false, 1, {}, [], '']) {
    for (const actor of ['author', 'pusher', 'reviewer']) {
      const snapshot = fixture();
      const target = actor === 'author' ? snapshot.pullRequest.author
        : actor === 'pusher' ? snapshot.pullRequest.lastPush.actor : snapshot.reviews.items[0].reviewer;
      target.login = value;
      assert.doesNotThrow(() => validateGovernance(snapshot));
      rejects(snapshot, 'IDENTITY');
    }
  }
});

test('a later comment preserves approval; a later requested change revokes it', () => {
  const snapshot = fixture();
  snapshot.reviews.items.push({ ...snapshot.reviews.items[0], id: 71, state: 'COMMENTED', submittedAt: '2026-09-26T11:20:00Z' });
  assert.deepEqual(validateGovernance(snapshot), { errors: [] });
  snapshot.reviews.items[1].state = 'CHANGES_REQUESTED';
  rejects(snapshot, 'CHANGES_REQUESTED');
  rejects(snapshot, 'APPROVAL');
});

test('approval threshold counts distinct reviewers, not repeated approvals', () => {
  const snapshot = fixture();
  snapshot.rules.requiredApprovingReviews = 2;
  snapshot.reviews.items.push({ ...snapshot.reviews.items[0], id: 71, submittedAt: '2026-09-26T11:20:00Z' });
  rejects(snapshot, 'APPROVAL');
  snapshot.reviews.items[1].reviewer = { id: 40, login: 'second-reviewer' };
  assert.deepEqual(validateGovernance(snapshot), { errors: [] });
});

test('latest check attempt wins; an old success cannot hide a running or failed rerun', () => {
  const snapshot = fixture();
  snapshot.checks.items.push({ ...structuredClone(snapshot.checks.items[0]), id: 81, status: 'in_progress', conclusion: null });
  rejects(snapshot, 'CHECK_RESULT');
  Object.assign(snapshot.checks.items[1], { status: 'completed', conclusion: 'failure' });
  rejects(snapshot, 'CHECK_RESULT');
  snapshot.checks.items[1].conclusion = 'success';
  assert.deepEqual(validateGovernance(snapshot), { errors: [] });
});

test('all required checks must execute; a green gate does not hide a skipped prerequisite', () => {
  const snapshot = fixture();
  snapshot.rules.requiredChecks.push({ name: 'security', appId: 200 });
  rejects(snapshot, 'CHECK_MISSING');
  snapshot.checks.items.push({ ...structuredClone(snapshot.checks.items[0]), id: 81, name: 'security', appId: 200, conclusion: 'skipped' });
  rejects(snapshot, 'CHECK_RESULT');
  snapshot.checks.items[1].conclusion = 'success';
  assert.deepEqual(validateGovernance(snapshot), { errors: [] });
});

test('CLI has fail-closed exits, explicit rules-only scope and no implicit phase downgrade', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'creezio-governance-'));
  const file = join(directory, 'snapshot.json');
  const policyFile = join(directory, 'policy.json');
  t.after(async () => { await rm(file, { force: true }); await rm(policyFile, { force: true }); await rmdir(directory); });
  const script = fileURLToPath(new URL('../../scripts/quality/governance.mjs', import.meta.url));
  const cli = (...args) => spawnSync(process.execPath, [script, '--policy', policyFile, ...args], { encoding: 'utf8', timeout: 10000 });
  await writeFile(policyFile, JSON.stringify(policyFixture()));
  await writeFile(file, JSON.stringify(fixture()));
  let result = cli('--snapshot', file);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).snapshotConforms, true);
  assert.equal(JSON.parse(result.stdout).mergeReady, false);
  assert.equal(JSON.parse(result.stdout).scope, 'supplied-snapshot-only');
  const single = singleMaintainer();
  await writeFile(policyFile, JSON.stringify(single.policy));
  await writeFile(file, JSON.stringify(single.snapshot));
  result = cli('--snapshot', file);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).snapshotConforms, true);
  assert.equal(JSON.parse(result.stdout).mergeReady, false);
  await writeFile(policyFile, JSON.stringify(policyFixture()));
  await writeFile(file, JSON.stringify(fixture('rules')));
  result = cli('--snapshot', file);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /PHASE_MISMATCH/);
  result = cli('--snapshot', file, '--phase', 'rules');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).mergeReady, false);
  const invalid = fixture();
  invalid.checks.items[0].conclusion = 'skipped';
  await writeFile(file, JSON.stringify(invalid));
  assert.equal(cli('--snapshot', file).status, 1);
  await writeFile(file, '{not-json');
  assert.equal(cli('--snapshot', file).status, 2);
  assert.equal(cli('--snapshot', join(directory, 'absent.json')).status, 2);
  assert.equal(cli().status, 2);
  assert.equal(cli('--snapshot', file, '--phase', 'unknown').status, 2);
  assert.equal(cli('--snapshot', file, '--snapshot', file).status, 2);
  assert.equal(cli('--snapshot', policyFile).status, 2);
  assert.equal(spawnSync(process.execPath, [script, '--snapshot', file], { encoding: 'utf8' }).status, 2);
});
