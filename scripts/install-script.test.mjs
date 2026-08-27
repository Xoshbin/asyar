import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..');
const installScript = join(repoRoot, 'install.sh');
const fixtures = [];

afterEach(() => {
  for (const fixture of fixtures.splice(0)) {
    rmSync(fixture, { recursive: true, force: true });
  }
});

function makeFixture({ arch = 'x86_64', failDownload, omitHelper = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'asyar-install-test-'));
  fixtures.push(root);
  const binDir = join(root, 'stub-bin');
  const installDir = join(root, 'install');
  const curlLog = join(root, 'curl.log');
  mkdirSync(binDir);
  mkdirSync(installDir);

  writeFileSync(
    join(binDir, 'uname'),
    `#!/bin/sh
case "\${1:-}" in
  -s) printf 'Linux\\n' ;;
  -m) printf '%s\\n' "${arch}" ;;
  *) exit 1 ;;
esac
`,
  );
  chmodSync(join(binDir, 'uname'), 0o755);

  writeFileSync(
    join(binDir, 'curl'),
    `#!/bin/sh
set -eu
output=''
url=''
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o) output=$2; shift 2 ;;
    -*) shift ;;
    *) url=$1; shift ;;
  esac
done
printf '%s\\n' "$url" >> "$STUB_CURL_LOG"
if [ -z "$output" ]; then
  if [ "$STUB_OMIT_HELPER" = '1' ]; then
    printf '%s\\n' '{"assets":[{"browser_download_url":"https://example.test/asyar_1.2.3_amd64.AppImage"},{"browser_download_url":"https://example.test/asyar_1.2.3_aarch64.AppImage"}]}'
    exit 0
  fi
  printf '%s\\n' '{"assets":[{"browser_download_url":"https://example.test/asyar_1.2.3_amd64.AppImage"},{"browser_download_url":"https://example.test/asyar_1.2.3_aarch64.AppImage"},{"browser_download_url":"https://example.test/asyar-summon_amd64"},{"browser_download_url":"https://example.test/asyar-summon_aarch64"}]}'
  exit 0
fi
case "$url" in
  *"$STUB_FAIL_DOWNLOAD"*) exit 22 ;;
  *asyar-summon_*) printf 'new-helper' > "$output" ;;
  *.AppImage) printf 'new-appimage' > "$output" ;;
  *) exit 22 ;;
esac
`,
  );
  chmodSync(join(binDir, 'curl'), 0o755);

  return {
    root,
    installDir,
    curlLog,
    env: {
      ...process.env,
      ASYAR_INSTALL_DIR: installDir,
      HOME: root,
      PATH: `${binDir}${delimiter}${process.env.PATH}`,
      STUB_CURL_LOG: curlLog,
      STUB_FAIL_DOWNLOAD: failDownload ?? '__never__',
      STUB_OMIT_HELPER: omitHelper ? '1' : '0',
    },
  };
}

function runInstaller(fixture) {
  return execFileSync('/bin/sh', [installScript], {
    cwd: repoRoot,
    env: fixture.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

describe('Linux installer', () => {
  it.each([
    ['x86_64', 'amd64'],
    ['aarch64', 'aarch64'],
  ])('installs matching AppImage and helper assets for %s', (arch, assetArch) => {
    const fixture = makeFixture({ arch });

    const output = runInstaller(fixture);

    expect(readFileSync(join(fixture.installDir, 'asyar'), 'utf8')).toBe('new-appimage');
    expect(readFileSync(join(fixture.installDir, 'asyar-summon'), 'utf8')).toBe('new-helper');
    expect(statSync(join(fixture.installDir, 'asyar')).mode & 0o111).not.toBe(0);
    expect(statSync(join(fixture.installDir, 'asyar-summon')).mode & 0o111).not.toBe(0);
    expect(readFileSync(fixture.curlLog, 'utf8')).toContain(`_${assetArch}.AppImage`);
    expect(readFileSync(fixture.curlLog, 'utf8')).toContain(`asyar-summon_${assetArch}`);
    expect(output).toContain(join(fixture.installDir, 'asyar'));
    expect(output).toContain(join(fixture.installDir, 'asyar-summon'));
    expect(output).toContain("isn't on your PATH");
  });

  it.each([
    ['AppImage', 'amd64.AppImage'],
    ['helper', 'asyar-summon_amd64'],
  ])('does not replace either installed file when the %s download fails', (_, failure) => {
    const fixture = makeFixture({ failDownload: failure });
    writeFileSync(join(fixture.installDir, 'asyar'), 'old-appimage');
    writeFileSync(join(fixture.installDir, 'asyar-summon'), 'old-helper');

    expect(() => runInstaller(fixture)).toThrow();

    expect(readFileSync(join(fixture.installDir, 'asyar'), 'utf8')).toBe('old-appimage');
    expect(readFileSync(join(fixture.installDir, 'asyar-summon'), 'utf8')).toBe('old-helper');
  });

  it('rejects unsupported Linux architectures', () => {
    const fixture = makeFixture({ arch: 'riscv64' });

    expect(() => runInstaller(fixture)).toThrow(/Unsupported Linux architecture/);
  });

  it.each(['asyar', 'asyar-summon'])(
    'rejects an existing %s directory before installation downloads',
    (directoryTarget) => {
      const fixture = makeFixture();
      const otherTarget = directoryTarget === 'asyar' ? 'asyar-summon' : 'asyar';
      mkdirSync(join(fixture.installDir, directoryTarget));
      writeFileSync(join(fixture.installDir, otherTarget), `old-${otherTarget}`);

      expect(() => runInstaller(fixture)).toThrow(/directory/);

      expect(readdirSync(join(fixture.installDir, directoryTarget))).toEqual([]);
      expect(readFileSync(join(fixture.installDir, otherTarget), 'utf8')).toBe(
        `old-${otherTarget}`,
      );
      expect(readFileSync(fixture.curlLog, 'utf8').trim().split('\n')).toHaveLength(1);
    },
  );

  it('rejects a symlink-to-directory target before installation downloads', () => {
    const fixture = makeFixture();
    const targetDirectory = join(fixture.root, 'unexpected-target');
    mkdirSync(targetDirectory);
    symlinkSync(targetDirectory, join(fixture.installDir, 'asyar-summon'), 'dir');
    writeFileSync(join(fixture.installDir, 'asyar'), 'old-appimage');

    expect(() => runInstaller(fixture)).toThrow(/directory/);

    expect(readdirSync(targetDirectory)).toEqual([]);
    expect(readFileSync(join(fixture.installDir, 'asyar'), 'utf8')).toBe('old-appimage');
    expect(readFileSync(fixture.curlLog, 'utf8').trim().split('\n')).toHaveLength(1);
  });

  it('preserves the installed pair when the release has no helper asset', () => {
    const fixture = makeFixture({ omitHelper: true });
    writeFileSync(join(fixture.installDir, 'asyar'), 'old-appimage');
    writeFileSync(join(fixture.installDir, 'asyar-summon'), 'old-helper');

    expect(() => runInstaller(fixture)).toThrow(/Could not find the summon helper/);

    expect(readFileSync(join(fixture.installDir, 'asyar'), 'utf8')).toBe('old-appimage');
    expect(readFileSync(join(fixture.installDir, 'asyar-summon'), 'utf8')).toBe('old-helper');
    expect(readFileSync(fixture.curlLog, 'utf8').trim().split('\n')).toHaveLength(1);
  });
});
