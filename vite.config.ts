import './scripts/local-environment.mjs';
import { defineConfig } from 'vite';
import vinext from 'vinext';
import hosting from './.openai/hosting.json';
import { fileURLToPath } from 'node:url';
import { composeRuntime } from './scripts/build/compose-runtime.mjs';
import { assertWorkerBoundary } from './scripts/build/worker-boundary.mjs';

export default defineConfig(async () => {
  const root = fileURLToPath(new URL('.', import.meta.url));
  await composeRuntime({ root,
    compositionPath: process.env.CREEZIO_COMPOSITION ?? 'configuration/composition.json',
    ...(process.env.CREEZIO_COMPOSITION_LOCK ? { lockPath: process.env.CREEZIO_COMPOSITION_LOCK } : {}),
  });
  await assertWorkerBoundary({ root, entryPoints: [
    '.creezio/generated/server.ts', '.creezio/generated/client.tsx', 'core/runtime/dispatch.ts',
  ] });
  const { cloudflare } = await import('@cloudflare/vite-plugin');
  return {
    server: { host: '127.0.0.1', port: 5173, strictPort: true },
    plugins: [
      vinext(),
      cloudflare({
        viteEnvironment: { name: 'rsc', childEnvironments: ['ssr'] },
        inspectorPort: false,
        persistState: { path: '.wrangler/state' },
        config: {
          name: 'creezio',
          main: 'worker.ts',
          compatibility_date: '2026-05-15',
          compatibility_flags: ['nodejs_compat'],
          vars: { CREEZIO_RUNTIME_PROFILE: 'local' },
          d1_databases: [{ binding: hosting.d1, database_name: 'creezio-local',
            database_id: '00000000-0000-4000-8000-000000000000' }],
          r2_buckets: [{ binding: hosting.r2, bucket_name: 'creezio-local' }],
        },
      }),
    ],
  };
});
