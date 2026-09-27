/** Local T32 Cloudflare control plane. No credential or response body enters error text. */
const ACCOUNT = /^[a-f0-9]{32}$/;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const NAME = /^[a-z][a-z0-9-]{1,62}[a-z0-9]$/;
const MAX_RESULT = 2 * 1024 * 1024;

export class CloudflareControlError extends Error {
  constructor(code, status = null) {
    super(`Cloudflare control plane ${code}.`);
    this.name = 'CloudflareControlError'; this.code = code; this.status = status;
  }
}
const fail = (code, status) => { throw new CloudflareControlError(code, status); };
const nameOK = value => typeof value === 'string' && NAME.test(value);

async function readJson(response) {
  const reader = response.body?.getReader();
  if (!reader) fail('unavailable', response.status);
  const chunks = []; let size = 0;
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESULT || chunks.length >= 4096) fail('response_too_large', response.status);
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks, size).toString('utf8'));
  } catch (error) {
    if (error instanceof CloudflareControlError) throw error;
    fail('unavailable', response.status);
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export function createCloudflareControlPlane({accountId, token, fetcher = fetch}) {
  if (!ACCOUNT.test(accountId ?? '') || typeof token !== 'string' || token.length < 20 ||
      /\s/.test(token) || typeof fetcher !== 'function') fail('invalid_configuration');
  const base = `https://api.cloudflare.com/client/v4/accounts/${accountId}`;
  async function request(path, {method = 'GET', body, jurisdiction, missing = false} = {}) {
    if (!path.startsWith('/') || path.includes('://')) fail('invalid_request');
    const url = path.startsWith('/user/') ? `https://api.cloudflare.com/client/v4${path}` : base + path;
    let response;
    try {
      response = await fetcher(url, {method, redirect: 'error', signal: AbortSignal.timeout(20_000),
        headers: {authorization: `Bearer ${token}`, ...(body ? {'content-type': 'application/json'} : {}),
          ...(jurisdiction ? {'cf-r2-jurisdiction': jurisdiction} : {})},
        body: body ? JSON.stringify(body) : undefined});
    } catch { fail('unavailable'); }
    if (!response || response.redirected || response.status >= 300 && response.status < 400) fail('refused', response?.status);
    if (missing && response.status === 404) return null;
    const value = await readJson(response);
    if (!response.ok || value?.success !== true) fail('refused', response.status);
    return value;
  }
  async function verifyToken(scope) {
    if (!['account', 'user'].includes(scope)) fail('invalid_request');
    const path = scope === 'account' ? '/tokens/verify' : '/user/tokens/verify';
    const value = (await request(path)).result;
    if (!/^[a-f0-9]{32}$/.test(value?.id ?? '') || value.status !== 'active') fail('token_inactive');
    return Object.freeze({id: value.id, scope, status: value.status});
  }
  async function workerSubdomain() {
    const value = (await request('/workers/subdomain')).result?.subdomain;
    if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(value)) fail('invalid_response');
    return value;
  }
  async function inspectConnection(scope) {
    const [verified, workersSubdomain] = await Promise.all([
      verifyToken(scope), workerSubdomain()
    ]);
    return Object.freeze({accountId, tokenId: verified.id, tokenScope: scope,
      workersSubdomain});
  }
  async function findD1(name) {
    if (!nameOK(name)) fail('invalid_request');
    let exact = null;
    for (let page = 1; page <= 20; page++) {
      const query = new URLSearchParams({name, page: String(page), per_page: '100'});
      const envelope = await request(`/d1/database?${query}`);
      if (!Array.isArray(envelope.result) || envelope.result.length > 100) fail('invalid_response');
      for (const item of envelope.result) if (item.name === name) {
        if (exact || !UUID.test(item.uuid ?? '')) fail('invalid_response');
        exact = {name, id: item.uuid, createdAt: item.created_at ?? null};
      }
      if (envelope.result.length < 100) return exact;
    }
    fail('limit');
  }
  async function createD1(name, jurisdiction = 'default') {
    if (!nameOK(name) || !['default', 'eu', 'us'].includes(jurisdiction)) fail('invalid_request');
    const value = (await request('/d1/database', {method: 'POST',
      body: {name, ...(jurisdiction === 'default' ? {} : {jurisdiction})}})).result;
    if (value?.name !== name || !UUID.test(value.uuid ?? '') ||
        jurisdiction !== 'default' && value.jurisdiction !== jurisdiction) fail('invalid_response');
    return {name, id: value.uuid, createdAt: value.created_at ?? null};
  }
  async function bucket(name, jurisdiction = 'default') {
    if (!nameOK(name) || !['default', 'eu', 'us'].includes(jurisdiction)) fail('invalid_request');
    const path = `/r2/buckets/${name}`;
    const result = await request(path, {jurisdiction, missing: true});
    if (!result) return null;
    if (result.result?.name !== name ||
        result.result.jurisdiction && result.result.jurisdiction !== jurisdiction) fail('invalid_response');
    const managed = (await request(path + '/domains/managed', {jurisdiction})).result;
    const custom = (await request(path + '/domains/custom', {jurisdiction})).result;
    if (typeof managed?.enabled !== 'boolean' || !Array.isArray(custom?.domains)) fail('invalid_response');
    return {name, jurisdiction, createdAt: result.result.creation_date ?? null,
      private: !managed.enabled && custom.domains.every(domain => domain?.enabled === false)};
  }
  async function createBucket(name, jurisdiction = 'default') {
    if (!nameOK(name) || !['default', 'eu', 'us'].includes(jurisdiction)) fail('invalid_request');
    const value = (await request('/r2/buckets', {method: 'POST', body: {name}, jurisdiction})).result;
    if (value?.name !== name || value.jurisdiction && value.jurisdiction !== jurisdiction) fail('invalid_response');
    return {name, jurisdiction, createdAt: value.creation_date ?? null};
  }
  async function workerSettings(name) {
    if (!nameOK(name)) fail('invalid_request');
    const value = await request(`/workers/scripts/${name}/settings`, {missing: true});
    return value?.result ?? null;
  }
  async function deployments(name) {
    if (!nameOK(name)) fail('invalid_request');
    const value = await request(`/workers/scripts/${name}/deployments?per_page=5`, {missing: true});
    if (!value) return {deployments: []};
    if (!Array.isArray(value.result?.deployments) || value.result.deployments.length > 5)
      fail('invalid_response');
    return {deployments: value.result.deployments};
  }
  async function workerDeployment(name) {
    return (await deployments(name)).deployments[0] ?? null;
  }
  async function workerVersion(name, id) {
    if (!nameOK(name) || !UUID.test(id ?? '')) fail('invalid_request');
    const value = await request(`/workers/scripts/${name}/versions/${id}`, {missing: true});
    if (!value) return null;
    if (value.result?.id !== id) fail('invalid_response');
    return value.result;
  }
  return Object.freeze({accountId, verifyToken, workerSubdomain, inspectConnection,
    findD1, database: findD1, createD1, bucket, createBucket, workerSettings,
    deployments, workerDeployment, version: workerVersion, workerVersion});
}
