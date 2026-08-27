import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { provisionSummon } from './prepare-asyar-summon.mjs';

const launcherDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function runLinuxBuild({ run = execFileSync, provision = provisionSummon } = {}) {
  run('pnpm', ['build'], { cwd: launcherDir, stdio: 'inherit' });
  provision();
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    runLinuxBuild();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Linux build preparation failed: ${message}`);
    process.exitCode = 1;
  }
}
