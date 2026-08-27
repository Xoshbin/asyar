import { chmodSync, copyFileSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SUPPORTED_TARGETS = new Set(['x86_64-unknown-linux-gnu', 'aarch64-unknown-linux-gnu']);

export function planSummonProvisioning(env, launcherDir) {
  const platform = env.TAURI_ENV_PLATFORM;
  if (platform !== 'linux') {
    throw new Error(`unsupported platform: ${platform ?? '<missing>'}`);
  }

  const targetTriple = env.TAURI_ENV_TARGET_TRIPLE;
  if (!targetTriple) {
    throw new Error('TAURI_ENV_TARGET_TRIPLE is required');
  }
  if (!SUPPORTED_TARGETS.has(targetTriple)) {
    throw new Error(`unsupported Linux target triple: ${targetTriple}`);
  }

  const tauriDir = resolve(launcherDir, 'src-tauri');
  return {
    command: 'cargo',
    args: ['build', '--release', '--package', 'asyar-summon', '--target', targetTriple],
    cwd: tauriDir,
    source: resolve(tauriDir, 'target', targetTriple, 'release', 'asyar-summon'),
    destination: resolve(tauriDir, 'binaries', `asyar-summon-${targetTriple}`),
  };
}

export function provisionSummon(env = process.env) {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const launcherDir = resolve(scriptDir, '..');
  const plan = planSummonProvisioning(env, launcherDir);

  execFileSync(plan.command, plan.args, {
    cwd: plan.cwd,
    stdio: 'inherit',
  });

  let sourceStat;
  try {
    sourceStat = statSync(plan.source);
  } catch (error) {
    throw new Error(`built helper is missing: ${plan.source}`, {
      cause: error,
    });
  }
  if (!sourceStat.isFile()) {
    throw new Error(`built helper is not a regular file: ${plan.source}`);
  }

  mkdirSync(dirname(plan.destination), { recursive: true });
  const temporaryDestination = `${plan.destination}.${process.pid}.tmp`;
  try {
    copyFileSync(plan.source, temporaryDestination);
    chmodSync(temporaryDestination, 0o755);
    renameSync(temporaryDestination, plan.destination);
  } finally {
    rmSync(temporaryDestination, { force: true });
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    provisionSummon();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to prepare asyar-summon: ${message}`);
    process.exitCode = 1;
  }
}
