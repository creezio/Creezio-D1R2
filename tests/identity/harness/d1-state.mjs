import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';

/** Only this test's synthetic D1 state; refuse an occupied or linked directory. */
export function createIdentityQualificationState(root) {
  const directory = resolve(root, '.quality/t04-identity-d1-state');
  const token = randomUUID();
  for (let current = directory; current !== dirname(resolve(root)); current = dirname(current)) {
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) throw new Error('Identity qualification state cannot traverse a link.');
  }
  if (existsSync(directory)) throw new Error('Identity qualification state already exists; inspect it before reuse.');
  mkdirSync(directory, { recursive: true });
  const marker = join(directory, '.qualification-owner.json');
  writeFileSync(marker, JSON.stringify({ owner: 'creezio-t04-identity-tests', token, pid: process.pid }));
  return { directory, cleanup() {
    // Every Miniflare instance must already be disposed by the caller.
    if (realpathSync(directory) !== directory || dirname(directory) !== resolve(root, '.quality')) throw new Error('Identity cleanup containment failed.');
    const owner = JSON.parse(readFileSync(marker, 'utf8'));
    if (owner.owner !== 'creezio-t04-identity-tests' || owner.token !== token || owner.pid !== process.pid) throw new Error('Identity cleanup ownership differs.');
    function inspect(path) {
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) throw new Error('Identity cleanup refuses linked entries.');
      if (stat.isDirectory()) for (const entry of readdirSync(path)) inspect(join(path, entry));
    }
    inspect(directory);
    if (process.platform === 'win32') execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      '$ErrorActionPreference="Stop"; $target=[IO.Path]::GetFullPath($env:CREEZIO_IDENTITY_TEST_STATE); $parent=[IO.Path]::GetFullPath($env:CREEZIO_IDENTITY_TEST_PARENT); if ([IO.Path]::GetDirectoryName($target) -ne $parent) { throw "Containment failed" }; Remove-Item -LiteralPath $target -Recurse -Force'],
    { env: { ...process.env, CREEZIO_IDENTITY_TEST_STATE: directory, CREEZIO_IDENTITY_TEST_PARENT: dirname(directory) }, stdio: 'pipe' });
    else rmSync(directory, { recursive: true });
  } };
}
