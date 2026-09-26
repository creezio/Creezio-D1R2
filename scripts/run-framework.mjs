import './local-environment.mjs';
import { fileURLToPath } from 'node:url';

const [command, ...args] = process.argv.slice(2);
if (!['dev', 'build'].includes(command)) throw new Error('Expected dev or build.');
// Keep the same process for cancellation and local preview ownership.
const cli = new URL('../node_modules/vinext/dist/cli.js', import.meta.url);
process.argv = [process.execPath, fileURLToPath(cli), command,
  ...(command === 'dev' ? ['--host', '127.0.0.1', '--port', '5173'] : []), ...args];
await import(cli.href);
