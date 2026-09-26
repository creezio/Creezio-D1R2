// Tool state stays in this checkout. No provider credential is required locally.
process.env.CLOUDFLARE_CF_FETCH_ENABLED ??= 'false';
process.env.WRANGLER_SEND_METRICS ??= 'false';
process.env.WRANGLER_WRITE_LOGS ??= 'false';
process.env.WRANGLER_LOG_PATH ??= '.wrangler/logs';
process.env.WRANGLER_REGISTRY_PATH ??= '.wrangler/dev-registry';
process.env.MINIFLARE_REGISTRY_PATH ??= '.wrangler/registry';
