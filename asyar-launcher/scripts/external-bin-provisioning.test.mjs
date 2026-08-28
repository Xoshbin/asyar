import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { planSummonProvisioning } from './prepare-asyar-summon.mjs';
import { runLinuxBuild } from './build-linux.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TAURI_CONF = resolve(__dirname, '..', 'src-tauri', 'tauri.conf.json');
const TAURI_LINUX_CONF = resolve(__dirname, '..', 'src-tauri', 'tauri.linux.conf.json');
const RELEASE_WORKFLOW = resolve(
  __dirname,
  '..',
  '..',
  '.github',
  'workflows',
  'release-launcher.yml',
);

// Sidecars (bun/uv/claude) are no longer build-time-bundled via Tauri
// `externalBin` — they're downloaded on demand at first use by
// `RuntimeManager`. This guards against that regressing: a binary declared
// in `externalBin` without being provisioned fails the Tauri build with
// "resource path 'binaries/<name>-<triple>' doesn't exist".
describe('externalBin', () => {
  it('declares no external binaries globally', () => {
    const conf = JSON.parse(readFileSync(TAURI_CONF, 'utf8'));
    const externalBin = conf.bundle?.externalBin ?? [];
    expect(externalBin).toEqual([]);
  });

  it('declares only the summon helper in the Linux platform config', () => {
    const conf = JSON.parse(readFileSync(TAURI_LINUX_CONF, 'utf8'));

    expect(conf.bundle?.externalBin).toEqual(['binaries/asyar-summon']);
    expect(conf.build?.beforeBuildCommand).toBe('node scripts/build-linux.mjs');
    expect(conf.build?.beforeBundleCommand).toBeUndefined();
  });
});

describe('asyar-summon provisioning', () => {
  const launcherDir = resolve(__dirname, '..');

  it.each(['x86_64-unknown-linux-gnu', 'aarch64-unknown-linux-gnu'])(
    'plans the target-suffixed binary for %s',
    (targetTriple) => {
      const plan = planSummonProvisioning(
        {
          TAURI_ENV_PLATFORM: 'linux',
          TAURI_ENV_TARGET_TRIPLE: targetTriple,
        },
        launcherDir,
      );

      expect(plan.command).toBe('cargo');
      expect(plan.args).toEqual([
        'build',
        '--release',
        '--package',
        'asyar-summon',
        '--target',
        targetTriple,
      ]);
      expect(plan.cwd).toBe(resolve(launcherDir, 'src-tauri'));
      expect(plan.source).toBe(
        resolve(launcherDir, 'src-tauri', 'target', targetTriple, 'release', 'asyar-summon'),
      );
      expect(plan.destination).toBe(
        resolve(launcherDir, 'src-tauri', 'binaries', `asyar-summon-${targetTriple}`),
      );
    },
  );

  it('fails clearly when TAURI_ENV_TARGET_TRIPLE is missing', () => {
    expect(() => planSummonProvisioning({ TAURI_ENV_PLATFORM: 'linux' }, launcherDir)).toThrow(
      'TAURI_ENV_TARGET_TRIPLE',
    );
  });

  it.each(['darwin', 'windows'])('rejects the %s platform', (platform) => {
    expect(() =>
      planSummonProvisioning(
        {
          TAURI_ENV_PLATFORM: platform,
          TAURI_ENV_TARGET_TRIPLE: 'x86_64-unknown-linux-gnu',
        },
        launcherDir,
      ),
    ).toThrow(`unsupported platform: ${platform}`);
  });

  it('rejects unsupported Linux target triples', () => {
    expect(() =>
      planSummonProvisioning(
        {
          TAURI_ENV_PLATFORM: 'linux',
          TAURI_ENV_TARGET_TRIPLE: 'x86_64-unknown-linux-musl',
        },
        launcherDir,
      ),
    ).toThrow('unsupported Linux target triple');
  });
});

describe('Linux build wrapper', () => {
  it('builds the launcher frontend before provisioning the helper', () => {
    const calls = [];

    runLinuxBuild({
      run(command, args, options) {
        calls.push({ command, args, cwd: options.cwd });
      },
      provision() {
        calls.push({ provision: 'asyar-summon' });
      },
    });

    expect(calls).toEqual([
      {
        command: 'pnpm',
        args: ['build'],
        cwd: resolve(__dirname, '..'),
      },
      { provision: 'asyar-summon' },
    ]);
    expect(calls.flatMap((call) => call.args ?? [])).not.toContain('tauri');
    expect(calls).not.toContainEqual(expect.objectContaining({ command: 'node' }));
  });
});

describe('standalone summon release assets', () => {
  it.each([
    ['x86_64-unknown-linux-gnu', 'asyar-summon-x86_64-unknown-linux-gnu', 'asyar-summon_amd64'],
    ['aarch64-unknown-linux-gnu', 'asyar-summon-aarch64-unknown-linux-gnu', 'asyar-summon_aarch64'],
  ])('keeps the source and public name together for %s', (target, source, asset) => {
    const workflow = readFileSync(RELEASE_WORKFLOW, 'utf8');

    expect(workflow).toMatch(
      new RegExp(
        `rust-target: ${target}\\n\\s+summon-source: ${source}\\n\\s+summon-asset: ${asset}`,
      ),
    );
  });
});

describe('Linux AppImage graphics ABI', () => {
  const workflow = readFileSync(RELEASE_WORKFLOW, 'utf8');

  it('installs an exclusion-capable linuxdeploy before the Tauri build', () => {
    const installStep = workflow.indexOf(
      '- name: Install linuxdeploy with library exclusion support',
    );
    const buildStep = workflow.indexOf('- name: Build Linux ${{ matrix.arch }}');

    expect(installStep).toBeGreaterThan(-1);
    expect(buildStep).toBeGreaterThan(installStep);
    expect(workflow).toContain(
      'linuxdeploy/releases/download/continuous/linuxdeploy-${linuxdeploy_arch}.AppImage',
    );
    expect(workflow).toContain(
      'linuxdeploy_cache_path="${tauri_tools_dir}/linuxdeploy-${linuxdeploy_arch}.AppImage"',
    );
  });

  it('excludes the build host Wayland client and verifies the finished AppImage', () => {
    expect(workflow).toContain("LINUXDEPLOY_EXCLUDED_LIBRARIES: 'libwayland-client.so*'");
    expect(workflow).toContain('- name: Verify AppImage graphics ABI');
    expect(workflow).toContain(
      '"$appimage_path" --appimage-extract \'usr/lib/libwayland-client.so*\'',
    );
    expect(workflow).toContain(
      "find squashfs-root \\( -type f -o -type l \\) -name 'libwayland-client.so*'",
    );
  });
});
