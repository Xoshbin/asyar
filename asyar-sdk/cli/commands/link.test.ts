import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Command } from 'commander';
import * as fs from 'fs';

vi.mock('fs', () => {
  const mocked = {
    existsSync: vi.fn(() => false),
    mkdirSync: vi.fn(),
    symlinkSync: vi.fn(),
    lstatSync: vi.fn(),
    unlinkSync: vi.fn(),
    rmSync: vi.fn(),
    copyFileSync: vi.fn(),
    readdirSync: vi.fn(() => []),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    renameSync: vi.fn(),
  };
  return { ...mocked, default: mocked };
});
vi.mock('child_process', () => {
  const mocked = { execSync: vi.fn() };
  return { ...mocked, default: mocked };
});
vi.mock('chokidar', () => ({ default: { watch: vi.fn(() => ({ on: vi.fn() })) } }));
vi.mock('../lib/manifest', () => ({ readManifest: vi.fn() }));
vi.mock('../lib/platform', () => ({
  getExtensionsDir: vi.fn((dev?: boolean) =>
    dev ? '/tmp/asyar-dev/extensions' : '/tmp/asyar/extensions',
  ),
  getDevExtensionsFile: vi.fn((dev?: boolean) =>
    dev ? '/tmp/asyar-dev/dev_extensions.json' : '/tmp/asyar/dev_extensions.json',
  ),
}));
vi.mock('./build', () => ({
  runViteBuild: vi.fn(() => Promise.resolve()),
  verifyBuildOutput: vi.fn(),
}));

import chokidar from 'chokidar';
import { readManifest } from '../lib/manifest';
import { getExtensionsDir, getDevExtensionsFile } from '../lib/platform';
import { runViteBuild, verifyBuildOutput } from './build';
import { registerLink, registerUnlink } from './link';

const workerOnlyManifest = {
  id: 'com.test.worker-only',
  name: 'Worker Only',
  type: 'extension',
  background: { main: 'dist/worker.js' },
  commands: [{ mode: 'background' }],
};

const themeManifest = {
  id: 'com.test.theme',
  name: 'Theme Ext',
  type: 'theme',
  commands: [],
};

describe('link command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.readFileSync).mockReturnValue('{}');
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

  it('passes isDevFlavor=true to getExtensionsDir and getDevExtensionsFile when --dev flag is provided', async () => {
    const program = new Command();
    registerLink(program);
    await program.parseAsync(['link', '--dev'], { from: 'user' });

    expect(vi.mocked(getExtensionsDir)).toHaveBeenCalledWith(true);
    expect(vi.mocked(getDevExtensionsFile)).toHaveBeenCalledWith(true);
  });

  it('passes isDevFlavor=undefined to getExtensionsDir and getDevExtensionsFile when --dev flag is omitted', async () => {
    const program = new Command();
    registerLink(program);
    await program.parseAsync(['link'], { from: 'user' });

    expect(vi.mocked(getExtensionsDir)).toHaveBeenCalledWith(undefined);
    expect(vi.mocked(getDevExtensionsFile)).toHaveBeenCalledWith(undefined);
  });

  it('registers extension in dev_extensions.json atomically', async () => {
    vi.mocked(fs.existsSync).mockImplementation((p) => {
      if (p === '/tmp/asyar/dev_extensions.json') return true;
      return false;
    });
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ 'existing.ext': '/path/to/existing' }),
    );

    const program = new Command();
    registerLink(program);
    await program.parseAsync(['link'], { from: 'user' });

    expect(fs.writeFileSync).toHaveBeenCalled();
    const writeCalls = vi.mocked(fs.writeFileSync).mock.calls;
    const devExtWrite = writeCalls.find((call) =>
      String(call[0]).startsWith('/tmp/asyar/dev_extensions.json.tmp'),
    );
    expect(devExtWrite).toBeDefined();
    const writtenJson = JSON.parse(devExtWrite![1] as string);
    expect(writtenJson).toEqual({
      'existing.ext': '/path/to/existing',
      'com.test.worker-only': process.cwd(),
    });
    expect(fs.renameSync).toHaveBeenCalledWith(devExtWrite![0], '/tmp/asyar/dev_extensions.json');
  });

  it('registers theme in dev_extensions.json too', async () => {
    vi.mocked(readManifest).mockReturnValue(themeManifest as any);
    const program = new Command();
    registerLink(program);
    await program.parseAsync(['link'], { from: 'user' });

    const writeCalls = vi.mocked(fs.writeFileSync).mock.calls;
    const devExtWrite = writeCalls.find((call) =>
      String(call[0]).startsWith('/tmp/asyar/dev_extensions.json.tmp'),
    );
    expect(devExtWrite).toBeDefined();
    const writtenJson = JSON.parse(devExtWrite![1] as string);
    expect(writtenJson).toEqual({
      'com.test.theme': process.cwd(),
    });
  });
});

describe('unlink command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readManifest).mockReturnValue(workerOnlyManifest as any);
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('unlinks extension directory and removes entry from dev_extensions.json', async () => {
    vi.mocked(fs.existsSync).mockImplementation((p) => {
      if (p === '/tmp/asyar/extensions/com.test.worker-only') return true;
      if (p === '/tmp/asyar/dev_extensions.json') return true;
      return false;
    });
    vi.mocked(fs.lstatSync).mockReturnValue({
      isSymbolicLink: () => true,
      isFIFO: () => false,
    } as any);
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({
        'com.test.worker-only': process.cwd(),
        'keep.ext': '/path/to/keep',
      }),
    );

    const program = new Command();
    registerUnlink(program);
    await program.parseAsync(['unlink'], { from: 'user' });

    expect(fs.unlinkSync).toHaveBeenCalledWith('/tmp/asyar/extensions/com.test.worker-only');
    expect(fs.writeFileSync).toHaveBeenCalled();
    const writeCalls = vi.mocked(fs.writeFileSync).mock.calls;
    const devExtWrite = writeCalls.find((call) =>
      String(call[0]).startsWith('/tmp/asyar/dev_extensions.json.tmp'),
    );
    expect(devExtWrite).toBeDefined();
    const writtenJson = JSON.parse(devExtWrite![1] as string);
    expect(writtenJson).toEqual({
      'keep.ext': '/path/to/keep',
    });
    expect(fs.renameSync).toHaveBeenCalledWith(devExtWrite![0], '/tmp/asyar/dev_extensions.json');
  });

  it('handles non-symlink target directory with rmSync', async () => {
    vi.mocked(fs.existsSync).mockImplementation((p) => {
      if (p === '/tmp/asyar/extensions/com.test.worker-only') return true;
      return false;
    });
    vi.mocked(fs.lstatSync).mockReturnValue({
      isSymbolicLink: () => false,
      isFIFO: () => false,
    } as any);

    const program = new Command();
    registerUnlink(program);
    await program.parseAsync(['unlink'], { from: 'user' });

    expect(fs.rmSync).toHaveBeenCalledWith('/tmp/asyar/extensions/com.test.worker-only', {
      recursive: true,
      force: true,
    });
  });

  it('unlinks from dev flavor when --dev is provided', async () => {
    vi.mocked(fs.existsSync).mockImplementation((p) => {
      if (p === '/tmp/asyar-dev/extensions/com.test.worker-only') return true;
      if (p === '/tmp/asyar-dev/dev_extensions.json') return true;
      return false;
    });
    vi.mocked(fs.lstatSync).mockReturnValue({
      isSymbolicLink: () => true,
      isFIFO: () => false,
    } as any);
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({
        'com.test.worker-only': process.cwd(),
      }),
    );

    const program = new Command();
    registerUnlink(program);
    await program.parseAsync(['unlink', '--dev'], { from: 'user' });

    expect(vi.mocked(getExtensionsDir)).toHaveBeenCalledWith(true);
    expect(vi.mocked(getDevExtensionsFile)).toHaveBeenCalledWith(true);
    expect(fs.unlinkSync).toHaveBeenCalledWith('/tmp/asyar-dev/extensions/com.test.worker-only');
    const writeCalls = vi.mocked(fs.writeFileSync).mock.calls;
    const devExtWrite = writeCalls.find((call) =>
      String(call[0]).startsWith('/tmp/asyar-dev/dev_extensions.json.tmp'),
    );
    expect(devExtWrite).toBeDefined();
    expect(JSON.parse(devExtWrite![1] as string)).toEqual({});
  });

  it('registers the unlink command correctly on commander', () => {
    const program = new Command();
    registerUnlink(program);
    const command = program.commands.find((c) => c.name() === 'unlink');
    expect(command).toBeDefined();
    expect(command!.description()).toBe('Unlink extension from Asyar extensions directory');
  });
});
