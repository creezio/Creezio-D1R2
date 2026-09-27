CREATE TABLE IF NOT EXISTS registry_bootstrap (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  maintainer_owner_id TEXT NOT NULL,
  service_id TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS registry_owners (
  id TEXT PRIMARY KEY,
  method TEXT NOT NULL CHECK (method IN ('bootstrap','email','github')),
  subject TEXT NOT NULL,
  email TEXT,
  verified_at_ms INTEGER NOT NULL,
  UNIQUE (method, subject)
);
CREATE TABLE IF NOT EXISTS registry_owner_sessions (
  digest TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES registry_owners(id),
  expires_at_ms INTEGER NOT NULL,
  revoked_at_ms INTEGER
);
CREATE TABLE IF NOT EXISTS registry_email_challenges (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  code_digest TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  consumed_at_ms INTEGER
);
CREATE TABLE IF NOT EXISTS registry_oauth_states (
  state_digest TEXT PRIMARY KEY,
  verifier TEXT NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  consumed_at_ms INTEGER
);
CREATE TABLE IF NOT EXISTS registry_projects (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES registry_owners(id),
  name TEXT NOT NULL,
  origin TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  owner_updated_at_ms INTEGER,
  owner_change_nonce TEXT
);
CREATE TABLE IF NOT EXISTS registry_installations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES registry_projects(id),
  target TEXT NOT NULL CHECK (target IN ('sites','cloudflare')),
  token_digest TEXT NOT NULL UNIQUE,
  token_version INTEGER NOT NULL DEFAULT 1,
  revoked_at_ms INTEGER,
  created_at_ms INTEGER NOT NULL,
  rotated_at_ms INTEGER
);
CREATE TABLE IF NOT EXISTS registry_preflights (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES registry_projects(id),
  installation_id TEXT NOT NULL REFERENCES registry_installations(id),
  target TEXT NOT NULL,
  artifact_json TEXT NOT NULL,
  token_version INTEGER NOT NULL,
  checked_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS registry_deployments (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES registry_projects(id),
  installation_id TEXT NOT NULL REFERENCES registry_installations(id),
  request_key_digest TEXT NOT NULL,
  payload_digest TEXT NOT NULL,
  deployment_id TEXT NOT NULL,
  url TEXT NOT NULL,
  repository_url TEXT,
  published_sha TEXT,
  artifact_json TEXT NOT NULL,
  declared_at_ms INTEGER NOT NULL,
  UNIQUE (installation_id, request_key_digest),
  UNIQUE (installation_id, deployment_id)
);
CREATE INDEX IF NOT EXISTS registry_deployments_installation ON registry_deployments(installation_id, declared_at_ms);
