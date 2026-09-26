#!/usr/bin/env node
/**
 * T-01 / REQ-0101..0103: validate supplied GitHub evidence, without network access.
 *
 * Snapshot v1 is a NORMALIZED observation, not a raw GitHub API response. A trusted
 * collector must resolve effective branch/ruleset settings, all bypass actors,
 * pagination, last push identity and the actual controller revision. Missing API
 * data must remain missing: it must never be normalized to a favorable default.
 * `expectedPolicy` is a SEPARATE argument from maintainer-approved configuration
 * outside the candidate PR. An embedded snapshot.policy is rejected.
 * Neither a JSON file nor this validator authenticates its own collector/policy.
 *
 * Required shape (see tests/quality/governance.test.mjs for a complete fixture):
 * Separate expectedPolicy:
 * {
 *     repository: 'owner/repo',
 *     reviewMode: 'single-maintainer' | 'independent-github',
 *     technicalReviewerRole: 'independent-agent', // required in single-maintainer
 *     authorizedReviewerIds: [GitHub numeric user ID], // independent-github only
 *     gate: { name: 'creezio/quality-gate', appId: positive integer,
 *       controller: { repository: 'owner/repo', path: 'path/to/controller', sha } }
 * }
 * Snapshot:
 * {
 *   schemaVersion: 1, phase: 'rules' | 'review', observedAt: UTC ISO timestamp,
 *   repository: { complete: true, fullName, defaultBranch: 'main', mainSha,
 *     allowSquashMerge: true, allowMergeCommit: false, allowRebaseMerge: false },
 *   rules: { complete: true, branch: 'main', enforcement: 'active',
 *     requiredPullRequest: true, requiredApprovingReviews: 0 in single-maintainer,
 *       // independent-github requires >= 1 and the following two protections:
 *     dismissStaleReviews: true, requireLastPushApproval: true,
 *     requireConversationResolution: true, requireUpToDateBranch: true,
 *     enforceAdmins: true, allowForcePushes: false, allowDeletions: false,
 *     bypassActors: [], requiredChecks: [{ name, appId }] }
 * }
 * Review additionally requires:
 * - pullRequest: { number, state:'open', draft:false, baseRepository, baseBranch,
 *   baseSha, headSha, mergeSha?: synthetic merge SHA, author:{id,login},
 *   lastPush:{actor:{id,login}, at, headSha} }
 * - comparison: { complete:true, baseSha, headSha, behindBy:0 }
 * - In single-maintainer mode, reviewEvidence: {reviewerRole, decision:'accepted',
 *   source:{headSha,baseSha}, reviewedAt}. The role must match expectedPolicy;
 *   it attests a separate technical review, never a GitHub account approval.
 *   A trusted collector must verify who actually issued that evidence.
 * - In independent-github mode, reviews: { complete:true, items:[{id, reviewer:{id,login},
 *   state:'APPROVED'|'CHANGES_REQUESTED'|'COMMENTED'|'DISMISSED'|'PENDING',
 *   commitSha, submittedAt}] }; PENDING has no submittedAt/commitSha requirement.
 * - checks: { complete:true, items:[{id, name, appId, status, conclusion,
 *   headSha: checked Git commit, source:{headSha:PR head,baseSha:main},
 *   completedAt, controller:{repository,path,sha}}] }
 *   Include the latest run per name/App (older attempts are permitted; highest
 *   numeric GitHub check-run ID wins). No truncated/paginated partial collection.
 * - conversations: { complete:true, unresolvedCount:0 }
 *
 * `rules` validates configuration only, never a review/merge. CLI defaults to
 * review; configuration-only checks require explicit --phase rules, preventing a
 * candidate-controlled snapshot from silently downgrading a merge check.
 * No freshness guarantee, tag protection, artifact validation, proof of denied
 * remote operations or authentication of evidence is supplied by this checker.
 * Collect again immediately before the authorized action and verify the trust
 * chain separately. It never activates protections or grants permission to merge.
 */
import { readFile, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isId = value => Number.isSafeInteger(value) && value > 0;
const isSha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const isText = value => typeof value === 'string' && value.trim().length > 0;
const isRepository = value => typeof value === 'string' && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value);
const time = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value)) return NaN;
  const parsed = Date.parse(value);
  const normalized = value.includes('.') ? value : value.replace('Z', '.000Z');
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === normalized ? parsed : NaN;
};
const sameController = (actual, expected) => isObject(actual) && isObject(expected)
  && ['repository', 'path', 'sha'].every(key => actual[key] === expected[key]);

/** Pure, fail-closed validation of an explicitly selected snapshot phase. */
export function validateGovernance(snapshot, expectedPolicy) {
  const errors = [];
  const require = (condition, code, path, message) => {
    if (!condition) errors.push(`${code}: ${path} ${message}`);
    return Boolean(condition);
  };
  const object = (value, path) => require(isObject(value), 'INCOMPLETE', path, 'must be an object');
  const identity = (value, path) => {
    if (!object(value, path)) return false;
    return require(isId(value.id) && isText(value.login), 'IDENTITY', path, 'requires numeric id and login');
  };
  if (!object(snapshot, 'snapshot')) return { errors };
  require(!Object.hasOwn(snapshot, 'policy'), 'SNAPSHOT_POLICY', 'snapshot.policy', 'must not supply its own expected authority');
  require(snapshot.schemaVersion === 1, 'VERSION', 'schemaVersion', 'must be 1');
  require(['rules', 'review'].includes(snapshot.phase), 'PHASE', 'phase', 'must explicitly be rules or review');
  const observedAt = time(snapshot.observedAt);
  require(Number.isFinite(observedAt), 'TIME', 'observedAt', 'must be a UTC ISO timestamp');
  const policy = isObject(expectedPolicy) ? expectedPolicy : {};
  object(expectedPolicy, 'expectedPolicy');
  require(isRepository(policy.repository), 'POLICY', 'policy.repository', 'must identify the expected repository');
  const reviewMode = policy.reviewMode;
  require(['single-maintainer', 'independent-github'].includes(reviewMode),
    'REVIEW_MODE', 'policy.reviewMode', 'must explicitly select single-maintainer or independent-github');
  if (reviewMode === 'single-maintainer') require(isText(policy.technicalReviewerRole),
    'REVIEWERS', 'policy.technicalReviewerRole', 'must identify the expected independent technical reviewer role');
  const gate = isObject(policy.gate) ? policy.gate : {};
  object(policy.gate, 'policy.gate');
  require(gate.name === 'creezio/quality-gate', 'GATE', 'policy.gate.name', 'must be creezio/quality-gate');
  require(isId(gate.appId), 'ORIGIN', 'policy.gate.appId', 'must pin a positive GitHub App ID');
  const controller = gate.controller;
  require(isObject(controller) && isRepository(controller.repository) && isText(controller.path)
    && !controller.path.startsWith('/') && !controller.path.includes('\\')
    && !controller.path.split('/').some(part => !part || part === '..' || part === '.')
    && isSha(controller.sha), 'ORIGIN', 'policy.gate.controller', 'must pin repository, relative path and full SHA');

  const repository = isObject(snapshot.repository) ? snapshot.repository : {};
  object(snapshot.repository, 'repository');
  require(repository.complete === true, 'INCOMPLETE', 'repository.complete', 'must be true');
  require(isRepository(repository.fullName) && repository.fullName === policy.repository,
    'REPOSITORY', 'repository.fullName', 'must match approved policy');
  require(repository.defaultBranch === 'main', 'BRANCH', 'repository.defaultBranch', 'must be main');
  require(isSha(repository.mainSha), 'SHA', 'repository.mainSha', 'requires the observed full main SHA');
  for (const [key, expected] of [['allowSquashMerge', true], ['allowMergeCommit', false], ['allowRebaseMerge', false]]) {
    require(repository[key] === expected, 'MERGE_METHOD', `repository.${key}`, `must be ${expected}`);
  }

  const rules = isObject(snapshot.rules) ? snapshot.rules : {};
  object(snapshot.rules, 'rules');
  require(rules.complete === true, 'INCOMPLETE', 'rules.complete', 'must cover all effective protections and bypasses');
  require(rules.branch === 'main', 'BRANCH', 'rules.branch', 'must be main');
  require(rules.enforcement === 'active', 'ENFORCEMENT', 'rules.enforcement', 'must be active');
  for (const key of ['requiredPullRequest',
    'requireConversationResolution', 'requireUpToDateBranch', 'enforceAdmins']) {
    require(rules[key] === true, 'PROTECTION', `rules.${key}`, 'must be true');
  }
  for (const key of ['allowForcePushes', 'allowDeletions']) {
    require(rules[key] === false, 'PROTECTION', `rules.${key}`, 'must be false');
  }
  if (reviewMode === 'single-maintainer') {
    require(rules.requiredApprovingReviews === 0, 'REVIEW_COUNT', 'rules.requiredApprovingReviews',
      'must be zero in the explicitly approved single-maintainer mode');
  } else if (reviewMode === 'independent-github') {
    require(isId(rules.requiredApprovingReviews), 'REVIEW_COUNT', 'rules.requiredApprovingReviews', 'must be at least one');
    for (const key of ['dismissStaleReviews', 'requireLastPushApproval']) {
      require(rules[key] === true, 'PROTECTION', `rules.${key}`, 'must be true in independent-github mode');
    }
  }
  require(Array.isArray(rules.bypassActors) && rules.bypassActors.length === 0,
    'BYPASS', 'rules.bypassActors', 'must explicitly be empty');
  const requiredChecks = Array.isArray(rules.requiredChecks) ? rules.requiredChecks : [];
  require(requiredChecks.length > 0, 'CHECK_REQUIRED', 'rules.requiredChecks', 'must not be missing or empty');
  const checkNames = new Set();
  for (const check of requiredChecks) {
    if (!require(isObject(check) && isText(check.name) && isId(check.appId),
      'CHECK_ORIGIN', 'rules.requiredChecks', 'each check requires a name and pinned App ID')) continue;
    require(!checkNames.has(check.name), 'CHECK_DUPLICATE', 'rules.requiredChecks', 'names must be unique');
    checkNames.add(check.name);
  }
  require(requiredChecks.some(check => isObject(check) && check.name === gate.name && check.appId === gate.appId),
    'GATE_REQUIRED', 'rules.requiredChecks', 'must require the approved quality gate and App ID');
  if (snapshot.phase !== 'review') return { errors };

  const pr = isObject(snapshot.pullRequest) ? snapshot.pullRequest : {};
  object(snapshot.pullRequest, 'pullRequest');
  require(isId(pr.number), 'PR', 'pullRequest.number', 'must be a positive integer');
  require(pr.state === 'open' && pr.draft === false, 'PR_STATE', 'pullRequest', 'must be open and ready for review');
  require(pr.baseRepository === policy.repository && pr.baseBranch === 'main',
    'PR_BASE', 'pullRequest', 'must target main of the approved repository');
  require(isSha(pr.headSha), 'SHA', 'pullRequest.headSha', 'requires a full SHA');
  require(isSha(pr.baseSha) && pr.baseSha === repository.mainSha,
    'PR_BASE', 'pullRequest.baseSha', 'must equal the currently observed main SHA');
  if (pr.mergeSha !== undefined) require(isSha(pr.mergeSha), 'SHA', 'pullRequest.mergeSha', 'must be a full synthetic merge SHA');
  const authorValid = identity(pr.author, 'pullRequest.author');
  const push = isObject(pr.lastPush) ? pr.lastPush : {};
  object(pr.lastPush, 'pullRequest.lastPush');
  const pusherValid = identity(push.actor, 'pullRequest.lastPush.actor');
  require(isSha(push.headSha) && push.headSha === pr.headSha, 'PUSH', 'pullRequest.lastPush.headSha', 'must match current PR head');
  const pushedAt = time(push.at);
  require(Number.isFinite(pushedAt) && pushedAt <= observedAt,
    'TIME', 'pullRequest.lastPush.at', 'must be observed and no later than snapshot');
  const comparison = isObject(snapshot.comparison) ? snapshot.comparison : {};
  object(snapshot.comparison, 'comparison');
  require(comparison.complete === true && comparison.baseSha === repository.mainSha
    && comparison.headSha === pr.headSha && comparison.behindBy === 0,
  'UP_TO_DATE', 'comparison', 'must prove current main is included in the current head');
  const conversations = snapshot.conversations;
  require(isObject(conversations) && conversations.complete === true && conversations.unresolvedCount === 0,
    'CONVERSATIONS', 'conversations', 'must completely report zero unresolved threads');

  if (reviewMode === 'single-maintainer') {
    const evidence = isObject(snapshot.reviewEvidence) ? snapshot.reviewEvidence : {};
    object(snapshot.reviewEvidence, 'reviewEvidence');
    require(evidence.reviewerRole === policy.technicalReviewerRole && isText(evidence.reviewerRole),
      'TECHNICAL_REVIEW_ROLE', 'reviewEvidence.reviewerRole', 'must match the independently configured reviewer role');
    require(evidence.decision === 'accepted', 'TECHNICAL_REVIEW_DECISION', 'reviewEvidence.decision', 'must be accepted');
    require(isObject(evidence.source) && evidence.source.headSha === pr.headSha
      && evidence.source.baseSha === repository.mainSha,
    'TECHNICAL_REVIEW_SHA', 'reviewEvidence.source', 'must cover the exact PR head and current main');
    const reviewedAt = time(evidence.reviewedAt);
    require(Number.isFinite(reviewedAt) && reviewedAt > pushedAt && reviewedAt <= observedAt,
      'TECHNICAL_REVIEW_TIME', 'reviewEvidence.reviewedAt', 'must be after the last push and no later than observation');
    // A technical attestation must not be relabelled as an author's GitHub approval.
    if (snapshot.reviews !== undefined) {
      const reviews = snapshot.reviews;
      require(isObject(reviews) && reviews.complete === true && Array.isArray(reviews.items),
        'INCOMPLETE', 'reviews', 'when supplied, GitHub review observations must be complete');
      for (const review of Array.isArray(reviews?.items) ? reviews.items : []) {
        if (review?.state === 'APPROVED') require(identity(review.reviewer, 'reviews.items[].reviewer')
          && authorValid && pusherValid && review.reviewer.id !== pr.author.id
          && review.reviewer.id !== push.actor.id
          && review.reviewer.login.toLowerCase() !== pr.author.login.toLowerCase()
          && review.reviewer.login.toLowerCase() !== push.actor.login.toLowerCase(),
        'SELF_APPROVAL', 'reviews', 'technical review cannot be represented by author/pusher GitHub approval');
      }
    }
  } else if (reviewMode === 'independent-github') {
  const authorized = policy.authorizedReviewerIds;
  require(Array.isArray(authorized) && authorized.length > 0 && authorized.every(isId)
    && new Set(authorized).size === authorized.length,
  'REVIEWERS', 'policy.authorizedReviewerIds', 'must list distinct authorized GitHub identities');
  const reviews = snapshot.reviews;
  require(isObject(reviews) && reviews.complete === true && Array.isArray(reviews.items),
    'INCOMPLETE', 'reviews', 'must contain the complete review collection');
  const latestReviews = new Map();
  const seenReviewIds = new Set();
  for (const review of Array.isArray(reviews?.items) ? reviews.items : []) {
    if (!object(review, 'reviews.items[]')) continue;
    const reviewerValid = identity(review.reviewer, 'reviews.items[].reviewer');
    require(isId(review.id) && !seenReviewIds.has(review.id), 'REVIEW_ID', 'reviews.items[].id', 'must be positive and unique');
    seenReviewIds.add(review.id);
    require(['APPROVED', 'CHANGES_REQUESTED', 'COMMENTED', 'DISMISSED', 'PENDING'].includes(review.state),
      'REVIEW_STATE', 'reviews.items[].state', 'must be a known GitHub review state');
    if (review.state === 'PENDING') continue;
    const submittedAt = time(review.submittedAt);
    require(Number.isFinite(submittedAt) && submittedAt <= observedAt,
      'TIME', 'reviews.items[].submittedAt', 'must be observed and no later than snapshot');
    require(isSha(review.commitSha), 'SHA', 'reviews.items[].commitSha', 'requires the reviewed full SHA');
    // A comment does not revoke an approval. Only later decisive reviews replace it.
    if (!reviewerValid || review.state === 'COMMENTED' || !Number.isFinite(submittedAt)) continue;
    const previous = latestReviews.get(review.reviewer.id);
    if (!previous || submittedAt > time(previous.submittedAt)
      || (submittedAt === time(previous.submittedAt) && review.id > previous.id)) {
      latestReviews.set(review.reviewer.id, review);
    }
  }
  const independent = reviewer => authorValid && pusherValid
    && reviewer.id !== pr.author.id && reviewer.id !== push.actor.id
    && reviewer.login.toLowerCase() !== pr.author.login.toLowerCase()
    && reviewer.login.toLowerCase() !== push.actor.login.toLowerCase();
  let approvals = 0;
  for (const review of latestReviews.values()) {
    if (!Array.isArray(authorized) || !authorized.includes(review.reviewer.id)) continue;
    require(review.state !== 'CHANGES_REQUESTED', 'CHANGES_REQUESTED', 'reviews', 'an authorized reviewer still requests changes');
    if (review.state === 'APPROVED' && independent(review.reviewer)
      && review.commitSha === pr.headSha && time(review.submittedAt) > pushedAt) approvals++;
  }
  require(approvals >= rules.requiredApprovingReviews && approvals > 0,
    'APPROVAL', 'reviews', 'need enough current approvals after the last push, independent of author and pusher');
  }

  const checks = snapshot.checks;
  require(isObject(checks) && checks.complete === true && Array.isArray(checks.items),
    'INCOMPLETE', 'checks', 'must contain the complete check collection');
  const items = Array.isArray(checks?.items) ? checks.items : [];
  const seenCheckIds = new Set();
  for (const check of items) {
    if (!object(check, 'checks.items[]')) continue;
    require(isId(check.id) && !seenCheckIds.has(check.id) && isText(check.name) && isId(check.appId),
      'CHECK_ID', 'checks.items[]', 'must have unique numeric id, name and App ID');
    seenCheckIds.add(check.id);
  }
  for (const required of requiredChecks.filter(isObject)) {
    const matching = items.filter(check => isObject(check) && check.name === required.name && check.appId === required.appId);
    const check = matching.reduce((last, current) => !last || current.id > last.id ? current : last, null);
    if (!require(Boolean(check), 'CHECK_MISSING', `checks.${required.name}`, 'requires a run from its pinned App')) continue;
    require(check.status === 'completed' && check.conclusion === 'success',
      'CHECK_RESULT', `checks.${required.name}`, 'latest run must be completed/success; skipped or neutral never pass');
    require(isSha(check.headSha) && (check.headSha === pr.headSha || check.headSha === pr.mergeSha)
      && isObject(check.source) && check.source.headSha === pr.headSha && check.source.baseSha === repository.mainSha,
    'CHECK_SHA', `checks.${required.name}`, 'must cover the exact PR head and current main composition');
    const completedAt = time(check.completedAt);
    require(Number.isFinite(completedAt) && completedAt >= pushedAt && completedAt <= observedAt,
      'CHECK_TIME', `checks.${required.name}`, 'must finish after the last push and before observation');
    if (required.name === gate.name) require(sameController(check.controller, controller),
      'CHECK_CONTROLLER', `checks.${required.name}`, 'must identify the approved controller repository/path/SHA; App alone is insufficient');
  }
  return { errors };
}

async function cli(args) {
  if (args.length === 1 && args[0] === '--help') {
    console.log('Usage: node scripts/quality/governance.mjs --policy <trusted-policy.json> --snapshot <snapshot.json> [--phase rules|review]\nDefault phase: review. Policy must come from approved configuration outside the PR. Offline snapshot validation only; rules never authorizes a merge.');
    return;
  }
  let filename;
  let policyFilename;
  let phase = 'review';
  const seen = new Set();
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i], value = args[i + 1];
    if (!['--snapshot', '--policy', '--phase'].includes(key) || seen.has(key) || !value || value.startsWith('--')) {
      console.error('USAGE: require --policy <trusted-policy.json> --snapshot <snapshot.json>, optionally --phase rules|review');
      process.exitCode = 2;
      return;
    }
    seen.add(key);
    if (key === '--snapshot') filename = value;
    else if (key === '--policy') policyFilename = value;
    else phase = value;
  }
  if (!filename || !policyFilename || !['rules', 'review'].includes(phase)) {
    console.error('USAGE: require --policy <trusted-policy.json> --snapshot <snapshot.json>, optionally --phase rules|review');
    process.exitCode = 2;
    return;
  }
  let snapshot;
  let expectedPolicy;
  try {
    const [snapshotPath, policyPath] = await Promise.all([realpath(filename), realpath(policyFilename)]);
    if (snapshotPath === policyPath) {
      console.error('POLICY_SOURCE: expected policy and observed snapshot must be separate files');
      process.exitCode = 2;
      return;
    }
    snapshot = JSON.parse(await readFile(snapshotPath, 'utf8'));
    expectedPolicy = JSON.parse(await readFile(policyPath, 'utf8'));
  }
  catch {
    console.error('SNAPSHOT_READ: readable JSON snapshot and separate policy are required');
    process.exitCode = 2;
    return;
  }
  const { errors } = validateGovernance(snapshot, expectedPolicy);
  if (snapshot?.phase !== phase) errors.push('PHASE_MISMATCH: snapshot phase must match the explicitly requested check');
  console.log(JSON.stringify({ scope: 'supplied-snapshot-only', phase,
    snapshotConforms: errors.length === 0, mergeReady: false, errors }, null, 2));
  process.exitCode = errors.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await cli(process.argv.slice(2));
}
