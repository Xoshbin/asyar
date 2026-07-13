/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/ipc/runtimeCommands', () => ({
  getRuntimeDownloadSizes: vi.fn(),
  downloadRuntime: vi.fn(),
}));
vi.mock('../../lib/ipc/commands', () => ({
  checkExtensionConsent: vi.fn(),
}));

import * as runtimeCommands from '../../lib/ipc/runtimeCommands';
import * as commands from '../../lib/ipc/commands';
import { extensionStateManager } from './extensionStateManager.svelte';
import { downloadDeclaredRuntimes } from './runtimeDownloads';

const getRuntimeDownloadSizes = vi.mocked(runtimeCommands.getRuntimeDownloadSizes);
const downloadRuntime = vi.mocked(runtimeCommands.downloadRuntime);
const checkExtensionConsent = vi.mocked(commands.checkExtensionConsent);

function status(declaredRuntimes: string[]) {
  return {
    needsConsent: false,
    declaredPermissions: [],
    declaredArgs: {},
    consented: null,
    declaredRuntimes,
  };
}

describe('downloadDeclaredRuntimes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    extensionStateManager.needsRuntime = [];
  });

  it('does nothing when the extension declares no runtimes', async () => {
    checkExtensionConsent.mockResolvedValue(status([]));
    await downloadDeclaredRuntimes('ext.a');
    expect(getRuntimeDownloadSizes).not.toHaveBeenCalled();
    expect(downloadRuntime).not.toHaveBeenCalled();
  });

  it('does nothing when the consent check itself fails', async () => {
    checkExtensionConsent.mockResolvedValue(null);
    await downloadDeclaredRuntimes('ext.a');
    expect(getRuntimeDownloadSizes).not.toHaveBeenCalled();
  });

  it('downloads nothing and clears needsRuntime when every declared runtime is already installed', async () => {
    checkExtensionConsent.mockResolvedValue(status(['bun']));
    getRuntimeDownloadSizes.mockResolvedValue([]);
    extensionStateManager.markNeedsRuntime('ext.a');
    await downloadDeclaredRuntimes('ext.a');
    expect(downloadRuntime).not.toHaveBeenCalled();
    expect(extensionStateManager.needsRuntime).toEqual([]);
  });

  it('downloads a missing runtime tagged with the extension consumer id, and clears needsRuntime on full success', async () => {
    checkExtensionConsent.mockResolvedValue(status(['bun']));
    getRuntimeDownloadSizes.mockResolvedValue([{ name: 'bun', sizeBytes: 100 }]);
    downloadRuntime.mockResolvedValue(true);
    extensionStateManager.markNeedsRuntime('ext.a');
    await downloadDeclaredRuntimes('ext.a');
    expect(downloadRuntime).toHaveBeenCalledWith('bun', 'ext:ext.a');
    expect(extensionStateManager.needsRuntime).toEqual([]);
  });

  it('marks the extension needsRuntime when a download fails, without throwing', async () => {
    checkExtensionConsent.mockResolvedValue(status(['bun']));
    getRuntimeDownloadSizes.mockResolvedValue([{ name: 'bun', sizeBytes: 100 }]);
    downloadRuntime.mockResolvedValue(false);
    await downloadDeclaredRuntimes('ext.a');
    expect(extensionStateManager.needsRuntime).toEqual(['ext.a']);
  });

  it('marks needsRuntime when at least one of several downloads fails', async () => {
    checkExtensionConsent.mockResolvedValue(status(['bun', 'uv']));
    getRuntimeDownloadSizes.mockResolvedValue([
      { name: 'bun', sizeBytes: 100 },
      { name: 'uv', sizeBytes: 200 },
    ]);
    downloadRuntime.mockImplementation(async (name) => name === 'bun');
    await downloadDeclaredRuntimes('ext.a');
    expect(downloadRuntime).toHaveBeenCalledTimes(2);
    expect(extensionStateManager.needsRuntime).toEqual(['ext.a']);
  });
});
