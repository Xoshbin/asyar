import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { verifyBuildOutput } from './build';

describe('verifyBuildOutput', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'asyar-build-test-'));
    fs.mkdirSync(path.join(cwd, 'dist'));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  function writeDist(...files: string[]) {
    for (const file of files) {
      fs.writeFileSync(path.join(cwd, 'dist', file), '<!doctype html>');
    }
  }

  it('accepts a view-only extension with dist/view.html', () => {
    writeDist('view.html');
    const manifest = { commands: [{ mode: 'view' }] };
    expect(() => verifyBuildOutput(cwd, manifest)).not.toThrow();
  });

  it('accepts a worker-only extension with dist/worker.html and no view.html', () => {
    writeDist('worker.html');
    const manifest = {
      background: { main: 'dist/worker.js' },
      commands: [{ mode: 'background' }],
    };
    expect(() => verifyBuildOutput(cwd, manifest)).not.toThrow();
  });

  it('accepts a view+worker extension with both entries', () => {
    writeDist('view.html', 'worker.html');
    const manifest = {
      background: { main: 'dist/worker.js' },
      commands: [{ mode: 'view' }, { mode: 'background' }],
    };
    expect(() => verifyBuildOutput(cwd, manifest)).not.toThrow();
  });

  it('rejects a worker-only extension whose worker.html is missing', () => {
    const manifest = {
      background: { main: 'dist/worker.js' },
      commands: [{ mode: 'background' }],
    };
    expect(() => verifyBuildOutput(cwd, manifest)).toThrow('process.exit(1)');
  });

  it('rejects a view+worker extension whose worker.html is missing', () => {
    writeDist('view.html');
    const manifest = {
      background: { main: 'dist/worker.js' },
      commands: [{ mode: 'view' }, { mode: 'background' }],
    };
    expect(() => verifyBuildOutput(cwd, manifest)).toThrow('process.exit(1)');
  });

  it('rejects an extension with a view command but no view.html', () => {
    writeDist('worker.html');
    const manifest = {
      background: { main: 'dist/worker.js' },
      commands: [{ mode: 'view' }, { mode: 'background' }],
    };
    expect(() => verifyBuildOutput(cwd, manifest)).toThrow('process.exit(1)');
  });

  it('requires view.html when no manifest is provided (legacy call)', () => {
    writeDist('worker.html');
    expect(() => verifyBuildOutput(cwd)).toThrow('process.exit(1)');
    writeDist('view.html');
    expect(() => verifyBuildOutput(cwd)).not.toThrow();
  });

  it('accepts legacy single-entry layouts without a manifest', () => {
    writeDist('index.html');
    expect(() => verifyBuildOutput(cwd)).not.toThrow();
  });
});
