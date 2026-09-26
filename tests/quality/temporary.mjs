import { mkdtempSync, rmSync, realpathSync, lstatSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { execFileSync } from 'node:child_process';

export function temporaryDirectory(t, prefix = 'creezio-quality-') {
  const parent = realpathSync(tmpdir());
  const root = mkdtempSync(join(parent, prefix));
  t.after(() => {
    if (dirname(realpathSync(root)) !== parent || !basename(root).startsWith(prefix)) throw new Error('Temporary path containment failed');
    const scan = path => {
      if (lstatSync(path).isSymbolicLink()) throw new Error('Refusing recursive cleanup across a link');
      if (lstatSync(path).isDirectory()) for (const entry of readdirSync(path)) scan(join(path, entry));
    };
    scan(root);
    if (process.platform === 'win32') {
      // Path is supplied as data, not interpolated into PowerShell code.
      execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        '$ErrorActionPreference="Stop"; $target=[IO.Path]::GetFullPath($env:CREEZIO_TEST_TMP); $parent=[IO.Path]::GetFullPath($env:CREEZIO_TEST_TMP_PARENT); if ([IO.Path]::GetDirectoryName($target) -ne $parent) { throw "Containment failed" }; Remove-Item -LiteralPath $target -Recurse -Force'],
      { env: { ...process.env, CREEZIO_TEST_TMP: root, CREEZIO_TEST_TMP_PARENT: parent }, stdio: 'pipe' });
    } else rmSync(root, { recursive: true, force: true });
  });
  return root;
}
