import './scripts/local-environment.mjs';
import { defineConfig } from 'vite';
import vinext from 'vinext';
import { fileURLToPath } from 'node:url';
import { composeRuntime } from './scripts/build/compose-runtime.mjs';
import { assertWorkerBoundary } from './scripts/build/worker-boundary.mjs';
import { loadLocalConfiguration, localWorkerConfiguration } from './scripts/local/config.mjs';

export default defineConfig(async () => {
  const root = fileURLToPath(new URL('.', import.meta.url));
  const local = loadLocalConfiguration({ root });
  await composeRuntime({ root,
    compositionPath: process.env.CREEZIO_COMPOSITION ?? 'configuration/composition.json',
    ...(process.env.CREEZIO_COMPOSITION_LOCK ? { lockPath: process.env.CREEZIO_COMPOSITION_LOCK } : {}),
  });
  await assertWorkerBoundary({ root, entryPoints: [
    '.creezio/generated/server.ts', '.creezio/generated/client.tsx', '.creezio/generated/operations.ts',
    'core/runtime/dispatch.ts', 'core/operations/http.ts',
  ] });
  const { cloudflare } = await import('@cloudflare/vite-plugin');
  return {
    server: { host: local.host, port: local.port, strictPort: true },
    plugins: [
      vinext(),
      cloudflare({
        viteEnvironment: { name: 'rsc', childEnvironments: ['ssr'] },
        inspectorPort: false,
        persistState: { path: local.statePath },
        config: localWorkerConfiguration(local),
      }),
    ],
  };
});
