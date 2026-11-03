// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import AdmZip from 'adm-zip';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const registryDir = vi.hoisted(() => ({ current: '' }));

vi.mock('./build', () => ({
  runViteBuild: vi.fn(() => Promise.resolve()),
  verifyBuildOutput: vi.fn(),
}));
vi.mock('../lib/platform', () => ({
  getDevExtensionsFile: vi.fn((dev?: boolean) =>
    path.join(registryDir.current, dev ? 'dev_extensions.dev.json' : 'dev_extensions.json'),
  ),
}));
vi.mock('../lib/auth', () => ({
  requireAuth: vi.fn(),
  getOrAuthorizeGitHub: vi.fn(),
  login: vi.fn(),
}));

import { runViteBuild, verifyBuildOutput } from './build';
import { requireAuth, getOrAuthorizeGitHub, login } from '../lib/auth';
import { registerPack, resolvePackOutput } from './pack';

const ID = 'org.asyar.pack-fixture';
const VERSION = '1.2.3';

const manifest = {
  id: ID,
  name: 'Pack Fixture',
  version: VERSION,
  type: 'extension',
  description: 'Fixture for asyar pack',
  author: 'Tester',
  icon: '🧪',
  asyarSdk: '^4.3.0',
  background: { main: 'dist/worker.js' },
  commands: [
    { id: 'open', name: 'Open', description: 'Opens the view', mode: 'view', component: 'Main' },
  ],
};

describe('asyar pack', () => {
  const tempDirs: string[] = [];
  let cwd: string;
  let logs: string[];
  let cwdSpy: ReturnType<typeof vi.spyOn>;
  const fetchSpy = vi.fn();

  function tempDir(): string {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'asyar-pack-test-')));
    tempDirs.push(dir);
    return dir;
  }

  function write(relative: string, content: string, mtime?: Date) {
    const file = path.join(cwd, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    if (mtime) fs.utimesSync(file, mtime, mtime);
  }

  async function pack(...args: string[]) {
    const program = new Command().exitOverride();
    registerPack(program);
    await program.parseAsync(['pack', ...args], { from: 'user' });
  }

  function entries(file: string): string[] {
    return new AdmZip(file)
      .getEntries()
      .map((e) => e.entryName)
      .sort();
  }

  function readEntry(file: string, name: string): string {
    const entry = new AdmZip(file).getEntry(name);
    expect(entry).not.toBeNull();
    return entry!.getData().toString('utf8');
  }

  beforeEach(() => {
    vi.clearAllMocks();
    cwd = tempDir();
    registryDir.current = tempDir();
    logs = [];
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(cwd);
    vi.spyOn(console, 'log').mockImplementation((...a) => void logs.push(a.join(' ')));
    vi.spyOn(console, 'error').mockImplementation((...a) => void logs.push(a.join(' ')));
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as never);
    vi.stubGlobal('fetch', fetchSpy);

    // Sources first, build output after, so the stale-build guard passes.
    const past = new Date(Date.now() - 60_000);
    write('manifest.json', JSON.stringify(manifest), past);
    write('src/main.ts', 'export {};', past);
    write('view.html', '<html></html>', past);
    write('worker.html', '<html></html>', past);
    write('vite.config.ts', 'export default {};', past);
    write('dist/view.html', '<html></html>');
    write('dist/worker.js', 'export {};');
    write('dist/assets/view.js', 'export {};');
  });

  afterEach(() => {
    cwdSpy.mockRestore();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('writes <id>-<version>.asyar to the extension folder with the publish layout', async () => {
    await pack();

    const out = path.join(cwd, `${ID}-${VERSION}.asyar`);
    expect(fs.existsSync(out)).toBe(true);
    expect(logs.some((l) => l.includes(out))).toBe(true);

    // Manifest at the root, dist/ flattened into it.
    expect(entries(out)).toEqual(['assets/view.js', 'manifest.json', 'view.html', 'worker.js']);
    const packaged = JSON.parse(readEntry(out, 'manifest.json'));
    expect(packaged.background.main).toBe('worker.js');

    // Same pre-package steps as publish.
    expect(runViteBuild).toHaveBeenCalledWith(cwd);
    expect(verifyBuildOutput).toHaveBeenCalledWith(cwd, manifest);
    // The temp zip packageExtension writes is not left behind.
    expect(fs.existsSync(path.join(os.tmpdir(), `${ID}-${VERSION}.zip`))).toBe(false);
  });

  it('never signs in or touches the network', async () => {
    await pack();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(requireAuth).not.toHaveBeenCalled();
    expect(getOrAuthorizeGitHub).not.toHaveBeenCalled();
    expect(login).not.toHaveBeenCalled();
  });

  it('writes into an --out folder', async () => {
    const outDir = tempDir();
    await pack('--out', outDir);

    expect(fs.existsSync(path.join(outDir, `${ID}-${VERSION}.asyar`))).toBe(true);
    expect(fs.existsSync(path.join(cwd, `${ID}-${VERSION}.asyar`))).toBe(false);
  });

  it('writes an --out .asyar file, creating its folder', async () => {
    const outFile = path.join(tempDir(), 'nested', 'custom.asyar');
    await pack('--out', outFile);

    expect(entries(outFile)).toContain('manifest.json');
  });

  it('refuses an --out file that Install from file would not accept', async () => {
    await expect(pack('--out', 'package.zip')).rejects.toThrow('process.exit(1)');
    expect(logs.some((l) => l.includes('.asyar'))).toBe(true);
    expect(fs.existsSync(path.join(cwd, 'package.zip'))).toBe(false);
  });

  it('stops on a stale build, like publish', async () => {
    write('src/main.ts', 'export const changed = true;', new Date(Date.now() + 60_000));

    await expect(pack()).rejects.toThrow('process.exit(1)');
    expect(fs.existsSync(path.join(cwd, `${ID}-${VERSION}.asyar`))).toBe(false);
  });

  it('pins README links to the release tag of the GitHub origin, as publish does', async () => {
    write('README.md', '![shot](docs/shot.png)\n');
    write('docs/shot.png', 'png');
    execFileSync('git', ['init', '-q'], { cwd });
    execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:acme/pack-fixture.git'], {
      cwd,
    });

    await pack();

    expect(readEntry(path.join(cwd, `${ID}-${VERSION}.asyar`), 'README.md')).toBe(
      `![shot](https://raw.githubusercontent.com/acme/pack-fixture/v${VERSION}/docs/shot.png)\n`,
    );
  });

  it('keeps README links as written when there is no GitHub origin', async () => {
    write('README.md', '![shot](docs/shot.png)\n');
    write('docs/shot.png', 'png');

    await pack();

    expect(readEntry(path.join(cwd, `${ID}-${VERSION}.asyar`), 'README.md')).toBe(
      '![shot](docs/shot.png)\n',
    );
  });

  it('stops when the README shows an image that does not exist', async () => {
    write('README.md', '![shot](docs/missing.png)\n');

    await expect(pack()).rejects.toThrow('process.exit(1)');
    expect(logs.some((l) => l.includes('docs/missing.png'))).toBe(true);
  });

  it('warns that a linked extension must be unlinked first', async () => {
    fs.writeFileSync(
      path.join(registryDir.current, 'dev_extensions.dev.json'),
      JSON.stringify({ [ID]: cwd }),
    );

    await pack();

    expect(logs.some((l) => l.includes('asyar unlink --dev'))).toBe(true);
  });

  it('warns when the package would block publish as an untracked file', async () => {
    execFileSync('git', ['init', '-q'], { cwd });

    await pack();
    expect(logs.some((l) => l.includes('.gitignore'))).toBe(true);

    logs.length = 0;
    write('.gitignore', '*.asyar\n');
    await pack();
    expect(logs.some((l) => l.includes('.gitignore'))).toBe(false);
  });
});

describe('resolvePackOutput', () => {
  const cwd = path.join(os.tmpdir(), 'ext');

  it('defaults to the extension folder', () => {
    expect(resolvePackOutput(cwd, 'a.b', '1.0.0')).toBe(path.join(cwd, 'a.b-1.0.0.asyar'));
  });

  it('treats a trailing slash as a folder, even one that does not exist yet', () => {
    expect(resolvePackOutput(cwd, 'a.b', '1.0.0', 'out/')).toBe(
      path.join(cwd, 'out', 'a.b-1.0.0.asyar'),
    );
  });

  it('resolves a relative .asyar file against the extension folder', () => {
    expect(resolvePackOutput(cwd, 'a.b', '1.0.0', 'pkg/x.asyar')).toBe(
      path.join(cwd, 'pkg', 'x.asyar'),
    );
  });

  it('rejects any other file name', () => {
    expect(() => resolvePackOutput(cwd, 'a.b', '1.0.0', 'x.zip')).toThrow('.asyar');
  });
});
