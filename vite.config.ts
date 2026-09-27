import './scripts/local-environment.mjs';
import { defineConfig } from 'vite';
import vinext from 'vinext';
import { fileURLToPath } from 'node:url';
import { composeRuntime } from './scripts/build/compose-runtime.mjs';
import { assertWorkerBoundary } from './scripts/build/worker-boundary.mjs';
import { loadLocalConfiguration, localWorkerConfiguration } from './scripts/local/config.mjs';
import {loadSitesBuildConfiguration} from './scripts/sites/config.mjs';
import {awaitLocalWidgetSandboxReady} from './scripts/local/widget-handshake.mjs';

export default defineConfig(async () => {
  const root = fileURLToPath(new URL('.', import.meta.url));
  const sites = process.env.CREEZIO_BUILD_PROFILE === 'sites' ? loadSitesBuildConfiguration({root}) : null;
  if (process.env.CREEZIO_BUILD_PROFILE && !['local','sites'].includes(process.env.CREEZIO_BUILD_PROFILE))
    throw new Error('Unsupported build profile.');
  const local = sites ? null : loadLocalConfiguration({ root });
  await composeRuntime({ root,
    compositionPath: process.env.CREEZIO_COMPOSITION ?? 'configuration/composition.json',
    ...(process.env.CREEZIO_COMPOSITION_LOCK ? { lockPath: process.env.CREEZIO_COMPOSITION_LOCK } : {}),
  });
  if(local)await awaitLocalWidgetSandboxReady();
  await assertWorkerBoundary({ root, entryPoints: [
    '.creezio/generated/server.ts', '.creezio/generated/client.tsx', '.creezio/generated/operations.ts', '.creezio/generated/provider-catalog.ts',
    'core/runtime/dispatch.ts', 'core/operations/http.ts',
  ] });
  const { cloudflare } = await import('@cloudflare/vite-plugin');
  return {
    server: { host: local?.host ?? '127.0.0.1', port: local?.port ?? 5173, strictPort: true },
    plugins: [
      vinext(),
      cloudflare({
        viteEnvironment: { name: 'rsc', childEnvironments: ['ssr'] },
        inspectorPort: false,
        persistState: local ? { path: local.statePath } : false,
        config: sites ? sites.worker : localWorkerConfiguration(local!),
      }),
    ],
  };
});
