/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// The real `import.meta.glob` in loadAllExtensions/loadSingleExtension eagerly
// imports every built-in feature module, some of which (e.g. runService)
// call real Tauri APIs at import time — stub them so that's inert here.
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn().mockResolvedValue(vi.fn()) }));

vi.mock('./log/logService', () => ({
  logService: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('./extension/extensionDiscovery', () => ({
  isBuiltInFeature: vi.fn().mockReturnValue(false),
}));
vi.mock('../lib/ipc/commands', () => ({
  discoverExtensions: vi.fn(),
  getExtension: vi.fn(),
}));
vi.mock('../lib/ipc/runtimeCommands', () => ({
  resolveRuntime: vi.fn(),
}));

import * as commands from '../lib/ipc/commands';
import * as runtimeCommands from '../lib/ipc/runtimeCommands';
import { extensionLoaderService } from './extensionLoaderService';
import { extensionStateManager } from './extension/extensionStateManager.svelte';

const discoverExtensions = vi.mocked(commands.discoverExtensions);
const getExtension = vi.mocked(commands.getExtension);
const resolveRuntime = vi.mocked(runtimeCommands.resolveRuntime);

function record(overrides: { manifest?: Record<string, unknown>; isBuiltIn?: boolean } = {}): any {
  return {
    manifest: {
      id: 'ext.test',
      name: 'Test',
      version: '1.0.0',
      description: 'Test extension',
      commands: [],
      ...overrides.manifest,
    },
    enabled: true,
    isBuiltIn: overrides.isBuiltIn ?? false,
    path: '/tmp/ext.test',
    compatibility: { status: 'unknown' },
    firstViewComponent: null,
  };
}

describe('extensionLoaderService — declared-runtime gating', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    extensionStateManager.needsRuntime = [];
  });

  it('loads an extension with no declared runtimes unaffected (no regression)', async () => {
    discoverExtensions.mockResolvedValue([record()]);
    const result = await extensionLoaderService.loadAllExtensions();
    expect(result.has('ext.test')).toBe(true);
    expect(resolveRuntime).not.toHaveBeenCalled();
  });

  it('loads an extension whose declared runtime is already installed', async () => {
    discoverExtensions.mockResolvedValue([record({ manifest: { runtimes: ['bun'] } })]);
    resolveRuntime.mockResolvedValue('/app-data/runtimes/bun/1.1.0/bun');
    const result = await extensionLoaderService.loadAllExtensions();
    expect(result.has('ext.test')).toBe(true);
    expect(extensionStateManager.needsRuntime).toEqual([]);
  });

  it('excludes an extension whose declared runtime is missing, and marks needsRuntime', async () => {
    discoverExtensions.mockResolvedValue([record({ manifest: { runtimes: ['bun'] } })]);
    resolveRuntime.mockResolvedValue(null);
    const result = await extensionLoaderService.loadAllExtensions();
    expect(result.has('ext.test')).toBe(false);
    expect(extensionStateManager.needsRuntime).toEqual(['ext.test']);
  });

  it('clears a previously-marked needsRuntime extension once its runtime resolves', async () => {
    extensionStateManager.markNeedsRuntime('ext.test');
    discoverExtensions.mockResolvedValue([record({ manifest: { runtimes: ['bun'] } })]);
    resolveRuntime.mockResolvedValue('/app-data/runtimes/bun/1.1.0/bun');
    const result = await extensionLoaderService.loadAllExtensions();
    expect(result.has('ext.test')).toBe(true);
    expect(extensionStateManager.needsRuntime).toEqual([]);
  });

  it('never gates a built-in feature on a missing declared runtime (built-ins are always trusted)', async () => {
    discoverExtensions.mockResolvedValue([
      record({ manifest: { runtimes: ['bun'] }, isBuiltIn: true }),
    ]);
    resolveRuntime.mockResolvedValue(null);
    const result = await extensionLoaderService.loadAllExtensions();
    expect(result.has('ext.test')).toBe(true);
    expect(resolveRuntime).not.toHaveBeenCalled();
    expect(extensionStateManager.needsRuntime).toEqual([]);
  });

  it('loadSingleExtension returns null when a declared runtime is missing', async () => {
    getExtension.mockResolvedValue(record({ manifest: { runtimes: ['bun'] } }) as any);
    resolveRuntime.mockResolvedValue(null);
    const result = await extensionLoaderService.loadSingleExtension('ext.test');
    expect(result).toBeNull();
    expect(extensionStateManager.needsRuntime).toEqual(['ext.test']);
  });
});
