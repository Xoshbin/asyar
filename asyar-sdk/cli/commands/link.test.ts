import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Command } from 'commander';

vi.mock('fs', () => {
  const mocked = {
    existsSync: vi.fn(() => false),
    mkdirSync: vi.fn(),
    symlinkSync: vi.fn(),
    lstatSync: vi.fn(),
    rmSync: vi.fn(),
    copyFileSync: vi.fn(),
    readdirSync: vi.fn(() => []),
  };
  return { ...mocked, default: mocked };
});
vi.mock('child_process', () => {
  const mocked = { execSync: vi.fn() };
  return { ...mocked, default: mocked };
});
vi.mock('chokidar', () => ({ default: { watch: vi.fn(() => ({ on: vi.fn() })) } }));
vi.mock('../lib/manifest', () => ({ readManifest: vi.fn() }));
vi.mock('../lib/platform', () => ({ getExtensionsDir: vi.fn(() => '/tmp/asyar-link-test') }));
vi.mock('./build', () => ({
  runViteBuild: vi.fn(() => Promise.resolve()),
  verifyBuildOutput: vi.fn(),
}));

import chokidar from 'chokidar';
import { readManifest } from '../lib/manifest';
import { getExtensionsDir } from '../lib/platform';
import { runViteBuild, verifyBuildOutput } from './build';
import { registerLink } from './link';

const workerOnlyManifest = {
  id: 'com.test.worker-only',
  type: 'extension',
  background: { main: 'dist/worker.js' },
  commands: [{ mode: 'background' }],
};

describe('link command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readManifest).mockReturnValue(workerOnlyManifest as any);
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('passes the manifest to verifyBuildOutput so worker-only extensions link', async () => {
    const program = new Command();
    registerLink(program);
    await program.parseAsync(['link'], { from: 'user' });

    expect(runViteBuild).toHaveBeenCalledWith(process.cwd());
    expect(verifyBuildOutput).toHaveBeenCalledWith(process.cwd(), workerOnlyManifest);
  });

  it('passes the manifest to verifyBuildOutput on watch-mode rebuilds too', async () => {
    let changeHandler: ((filePath: string) => Promise<void>) | undefined;
    vi.mocked(chokidar.watch).mockReturnValue({
      on: vi.fn((event: string, handler: any) => {
        if (event === 'change') changeHandler = handler;
      }),
    } as any);

    const program = new Command();
    registerLink(program);
    await program.parseAsync(['link', '--watch'], { from: 'user' });

    expect(changeHandler).toBeDefined();
    vi.mocked(verifyBuildOutput).mockClear();
    await changeHandler!('/some/project/src/index.ts');

    expect(verifyBuildOutput).toHaveBeenCalledWith(process.cwd(), workerOnlyManifest);
  });

  it('passes isDevFlavor=true to getExtensionsDir when --dev flag is provided', async () => {
    const program = new Command();
    registerLink(program);
    await program.parseAsync(['link', '--dev'], { from: 'user' });

    expect(vi.mocked(getExtensionsDir)).toHaveBeenCalledWith(true);
  });

  it('passes isDevFlavor=undefined to getExtensionsDir when --dev flag is omitted', async () => {
    const program = new Command();
    registerLink(program);
    await program.parseAsync(['link'], { from: 'user' });

    expect(vi.mocked(getExtensionsDir)).toHaveBeenCalledWith(undefined);
  });
});
