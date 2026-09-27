import { builtinModules } from 'node:module';
import { resolve, relative, isAbsolute, sep } from 'node:path';
import { dirname } from 'node:path';
import { lstatSync, realpathSync } from 'node:fs';
import { build } from 'esbuild';

const builtins = new Set(builtinModules.flatMap(name => [name, name.replace(/^node:/, '')]));

/** Check selected module/core entries, not framework internals. This does not execute their code. */
export async function assertWorkerBoundary({ root, entryPoints }) {
  const directory = resolve(root);
  const sdkAlias = resolve(directory, 'node_modules/@creezio/sdk');
  const sdkSource = resolve(directory, 'sdk');
  const sdkCompiledAlias = resolve(sdkAlias, 'dist/esm');
  const sdkCompiledSource = resolve(sdkSource, 'dist/esm');
  const within = (base, target) => {
    const local = relative(base, target);
    return !isAbsolute(local) && local !== '..' && !local.startsWith(`..${sep}`);
  };
  const samePath = (left, right) => process.platform === 'win32'
    ? left.toLowerCase() === right.toLowerCase() : left === right;
  // npm's one workspace junction is permitted only for the compiled public SDK graph.
  // The matching physical path also rejects any second link below dist/esm.
  const compiledWorkspaceSdk = target => {
    if (!within(sdkCompiledAlias, target)) return false;
    try {
      if (!lstatSync(sdkAlias).isSymbolicLink() || lstatSync(sdkSource).isSymbolicLink()
        || !samePath(realpathSync(sdkAlias), realpathSync(sdkSource))) return false;
      const expected = resolve(sdkSource, relative(sdkAlias, target));
      return within(sdkCompiledSource, expected) && samePath(realpathSync(target), expected);
    } catch { return false; }
  };
  const confined = target => {
    const local = relative(directory, target);
    if (isAbsolute(local) || local === '..' || local.startsWith('../') || local.startsWith('..\\')) throw new Error('Selected Worker import escapes the project.');
    for (let current = target; current !== dirname(directory); current = dirname(current)) {
      if (lstatSync(current).isSymbolicLink()
        && !(samePath(current, sdkAlias) && compiledWorkspaceSdk(target)))
        throw new Error('Selected Worker import traverses a link.');
    }
    const physical = relative(realpathSync(directory), realpathSync(target));
    if (isAbsolute(physical) || physical === '..' || physical.startsWith('../') || physical.startsWith('..\\')) throw new Error('Selected Worker import escapes the project.');
  };
  if (!Array.isArray(entryPoints) || entryPoints.length === 0) throw new Error('Worker boundary requires explicit entry points.');
  const entries = entryPoints.map(entry => {
    if (typeof entry !== 'string') throw new Error('Worker boundary entries must be file paths.');
    const absolute = resolve(directory, entry), local = relative(directory, absolute);
    if (isAbsolute(local) || local === '..' || local.startsWith('../') || local.startsWith('..\\')) throw new Error('Worker boundary entry escapes the project.');
    confined(absolute);
    return absolute;
  });
  const result = await build({
    absWorkingDir: directory, entryPoints: entries, bundle: true, write: false, metafile: true,
    outdir: '.quality/worker-boundary-memory', platform: 'browser', format: 'esm', target: 'es2022', preserveSymlinks: true,
    conditions: ['workerd', 'worker', 'browser'], mainFields: ['browser', 'module', 'main'],
    logLevel: 'silent', plugins: [{ name: 'creezio-worker-boundary', setup(bundler) {
      bundler.onResolve({ filter: /.*/ }, args => {
        if (args.path.startsWith('node:') || builtins.has(args.path)) return {
          errors: [{ text: `Selected application code cannot import Node builtin ${args.path}. Use a compatible external service or Worker API.` }],
        };
        if (args.path === 'cloudflare:workers') return { path: args.path, external: true };
        if (/^(?:https?|data):/.test(args.path)) return { errors: [{ text: 'Selected Worker imports must be local reviewed sources.' }] };
        return undefined;
      });
      // onLoad runs before esbuild reads a resolved source. Keep links visible during resolution.
      bundler.onLoad({ filter: /.*/, namespace: 'file' }, args => {
        try { confined(args.path); } catch (error) { return { errors: [{ text: error.message }] }; }
        return undefined;
      });
    } }],
  });
  return { scope: 'selected-worker-import-graph', entries: entries.map(entry => relative(directory, entry).replaceAll('\\', '/')),
    inputs: Object.keys(result.metafile.inputs).sort(), outputBytes: result.outputFiles.reduce((total, file) => total + file.contents.length, 0) };
}
