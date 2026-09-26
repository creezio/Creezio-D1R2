import { mkdirSync, existsSync, writeFileSync, readFileSync, lstatSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

/** Only synthetic qualification data lives here; never use the app's Miniflare database directory. */
export function qualificationState(root) {
  return ownedDirectory(root, '.wrangler/state/qualification-t03');
}

export function qualificationScratch(root) {
  return ownedDirectory(root, '.quality/runtime-incompatible');
}

function ownedDirectory(root, path) {
  const directory = resolve(root, path), parentDirectory = dirname(directory);
  const token = randomUUID();
  for (let current = directory; current !== dirname(resolve(root)); current = dirname(current)) {
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) throw new Error('Qualification state cannot traverse a link.');
  }
  if (existsSync(directory)) throw new Error('Reserved qualification state already exists; inspect it before reusing it. No data was removed.');
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, '.qualification-owner.json'), JSON.stringify({ owner: 'creezio-t03-workerd-tests', token, pid: process.pid }));
  return {
    directory,
    // Caller must first await disposal of every Miniflare instance using this directory.
    cleanup() {
      if (realpathSync(directory) !== directory || dirname(directory) !== parentDirectory) throw new Error('Qualification cleanup containment failed.');
      const owner = JSON.parse(readFileSync(join(directory, '.qualification-owner.json'), 'utf8'));
      if (owner.owner !== 'creezio-t03-workerd-tests' || owner.token !== token || owner.pid !== process.pid) throw new Error('Qualification cleanup ownership differs.');
      function inspect(path) {
        const stat = lstatSync(path);
        if (stat.isSymbolicLink()) throw new Error('Qualification cleanup refuses linked entries.');
        if (stat.isDirectory()) for (const entry of readdirSync(path)) inspect(join(path, entry));
      }
      inspect(directory);
      if (process.platform === 'win32') execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        '$ErrorActionPreference="Stop"; $target=[IO.Path]::GetFullPath($env:CREEZIO_QUALIFICATION_STATE); $parent=[IO.Path]::GetFullPath($env:CREEZIO_QUALIFICATION_PARENT); if ([IO.Path]::GetDirectoryName($target) -ne $parent) { throw "Containment failed" }; Remove-Item -LiteralPath $target -Recurse -Force'],
      { env: { ...process.env, CREEZIO_QUALIFICATION_STATE: directory, CREEZIO_QUALIFICATION_PARENT: dirname(directory) }, stdio: 'pipe' });
      else rmSync(directory, { recursive: true });
    },
  };
}
