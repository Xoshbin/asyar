/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/ipc/commands', () => ({
  checkExtensionConsent: vi.fn(),
  setExtensionConsent: vi.fn().mockResolvedValue(undefined),
  registerExtensionPermissions: vi
    .fn()
    .mockResolvedValue({ registered: true, needsConsent: false }),
  revokeExtensionConsent: vi.fn().mockResolvedValue(true),
  getExtension: vi.fn().mockResolvedValue(null),
}));
vi.mock('../../lib/ipc/devCommands', () => ({
  forceRemountWorker: vi.fn().mockResolvedValue(true),
}));
vi.mock('../../lib/ipc/runtimeCommands', () => ({
  getRuntimeDownloadSizes: vi.fn().mockResolvedValue([]),
}));
vi.mock('../log/logService', () => ({
  logService: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import * as commands from '../../lib/ipc/commands';
import * as runtimeCommands from '../../lib/ipc/runtimeCommands';
import { forceRemountWorker } from '../../lib/ipc/devCommands';
import { permissionConsentService } from './permissionConsentService.svelte';

const checkExtensionConsent = vi.mocked(commands.checkExtensionConsent);
const setExtensionConsent = vi.mocked(commands.setExtensionConsent);
const registerExtensionPermissions = vi.mocked(commands.registerExtensionPermissions);
const revokeExtensionConsent = vi.mocked(commands.revokeExtensionConsent);
const getRuntimeDownloadSizes = vi.mocked(runtimeCommands.getRuntimeDownloadSizes);

function request(id = 'ext.a') {
  return {
    extensionId: id,
    extensionName: id,
    reason: 'install' as const,
    permissions: ['network'],
    permissionArgs: {},
  };
}

describe('permissionConsentService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    permissionConsentService.reset();
  });

  it('resolves true on accept and clears the active request', async () => {
    const promise = permissionConsentService.requestConsent(request());
    expect(permissionConsentService.activeRequest?.extensionId).toBe('ext.a');
    permissionConsentService.onAccepted();
    await expect(promise).resolves.toBe(true);
    expect(permissionConsentService.activeRequest).toBeNull();
  });

  it('resolves false on decline', async () => {
    const promise = permissionConsentService.requestConsent(request());
    permissionConsentService.onDeclined();
    await expect(promise).resolves.toBe(false);
  });

  it('queues concurrent requests FIFO instead of cancelling the second', async () => {
    const first = permissionConsentService.requestConsent(request('ext.a'));
    const second = permissionConsentService.requestConsent(request('ext.b'));

    expect(permissionConsentService.activeRequest?.extensionId).toBe('ext.a');
    permissionConsentService.onAccepted();
    await expect(first).resolves.toBe(true);

    expect(permissionConsentService.activeRequest?.extensionId).toBe('ext.b');
    permissionConsentService.onDeclined();
    await expect(second).resolves.toBe(false);
  });

  it('ensureConsent skips the prompt when consent already covers', async () => {
    checkExtensionConsent.mockResolvedValue({
      needsConsent: false,
      declaredPermissions: ['network'],
      declaredArgs: {},
      consented: null,
      declaredRuntimes: [],
    });
    const result = await permissionConsentService.ensureConsent('ext.a', 'Ext A', 'enable');
    expect(result).toBe(true);
    expect(permissionConsentService.activeRequest).toBeNull();
    expect(setExtensionConsent).not.toHaveBeenCalled();
  });

  it('ensureConsent persists and re-registers on acceptance', async () => {
    checkExtensionConsent.mockResolvedValue({
      needsConsent: true,
      declaredPermissions: ['fs:watch'],
      declaredArgs: { 'fs:watch': ['~/a/**'] },
      consented: null,
      declaredRuntimes: [],
    });

    const versionBefore = permissionConsentService.consentVersion;
    const promise = permissionConsentService.ensureConsent('ext.a', 'Ext A', 'update');
    await vi.waitFor(() => {
      expect(permissionConsentService.activeRequest).not.toBeNull();
    });
    expect(permissionConsentService.activeRequest?.permissions).toEqual(['fs:watch']);
    permissionConsentService.onAccepted();

    await expect(promise).resolves.toBe(true);
    expect(setExtensionConsent).toHaveBeenCalledWith('ext.a', ['fs:watch'], {
      'fs:watch': ['~/a/**'],
    });
    expect(registerExtensionPermissions).toHaveBeenCalledWith('ext.a', ['fs:watch'], {
      'fs:watch': ['~/a/**'],
    });
    expect(permissionConsentService.consentVersion).toBe(versionBefore + 1);
  });

  it('acceptance remounts the worker of an enabled background extension', async () => {
    checkExtensionConsent.mockResolvedValue({
      needsConsent: true,
      declaredPermissions: ['shell:spawn'],
      declaredArgs: { 'shell:spawn': ['shortcuts'] },
      consented: null,
      declaredRuntimes: [],
    });
    vi.mocked(commands.getExtension).mockResolvedValue({
      manifest: { id: 'ext.a', background: { main: 'dist/worker.js' } },
      enabled: true,
      isBuiltIn: false,
      path: '/tmp/ext.a',
    } as never);

    const promise = permissionConsentService.ensureConsent('ext.a', 'Ext A', 'review');
    await vi.waitFor(() => {
      expect(permissionConsentService.activeRequest).not.toBeNull();
    });
    permissionConsentService.onAccepted();

    await expect(promise).resolves.toBe(true);
    expect(forceRemountWorker).toHaveBeenCalledWith('ext.a', true);
  });

  it('acceptance does not remount when the extension is disabled or has no worker', async () => {
    checkExtensionConsent.mockResolvedValue({
      needsConsent: true,
      declaredPermissions: ['network'],
      declaredArgs: {},
      consented: null,
      declaredRuntimes: [],
    });
    // Disabled at consent time — the enable flow mounts the worker itself
    // right after; a mount emit now would strand the worker machine.
    vi.mocked(commands.getExtension).mockResolvedValue({
      manifest: { id: 'ext.a', background: { main: 'dist/worker.js' } },
      enabled: false,
      isBuiltIn: false,
      path: '/tmp/ext.a',
    } as never);

    let promise = permissionConsentService.ensureConsent('ext.a', 'Ext A', 'enable');
    await vi.waitFor(() => expect(permissionConsentService.activeRequest).not.toBeNull());
    permissionConsentService.onAccepted();
    await expect(promise).resolves.toBe(true);
    expect(forceRemountWorker).not.toHaveBeenCalled();

    // Enabled but view-only (no background.main) — permission gate is live
    // per-call, nothing to re-activate.
    vi.mocked(commands.getExtension).mockResolvedValue({
      manifest: { id: 'ext.b' },
      enabled: true,
      isBuiltIn: false,
      path: '/tmp/ext.b',
    } as never);

    promise = permissionConsentService.ensureConsent('ext.b', 'Ext B', 'review');
    await vi.waitFor(() => expect(permissionConsentService.activeRequest).not.toBeNull());
    permissionConsentService.onAccepted();
    await expect(promise).resolves.toBe(true);
    expect(forceRemountWorker).not.toHaveBeenCalled();
  });

  it('ensureConsent neither persists nor registers on decline', async () => {
    checkExtensionConsent.mockResolvedValue({
      needsConsent: true,
      declaredPermissions: ['network'],
      declaredArgs: {},
      consented: null,
      declaredRuntimes: [],
    });

    const promise = permissionConsentService.ensureConsent('ext.a', 'Ext A', 'enable');
    await vi.waitFor(() => {
      expect(permissionConsentService.activeRequest).not.toBeNull();
    });
    permissionConsentService.onDeclined();

    await expect(promise).resolves.toBe(false);
    expect(setExtensionConsent).not.toHaveBeenCalled();
    expect(registerExtensionPermissions).not.toHaveBeenCalled();
  });

  it('ensureConsent proceeds without prompting when the consent check fails', async () => {
    // Rust's load-time backstop still withholds unconsented permissions, so
    // failing open here only affects UX, never enforcement.
    checkExtensionConsent.mockResolvedValue(null);
    const result = await permissionConsentService.ensureConsent('ext.a', 'Ext A', 'enable');
    expect(result).toBe(true);
    expect(permissionConsentService.activeRequest).toBeNull();
  });

  it('markNeedsReview dedupes and ensureConsent clears it once covered', async () => {
    permissionConsentService.markNeedsReview('ext.a');
    permissionConsentService.markNeedsReview('ext.a');
    expect(permissionConsentService.needsReview).toEqual(['ext.a']);

    checkExtensionConsent.mockResolvedValue({
      needsConsent: false,
      declaredPermissions: ['network'],
      declaredArgs: {},
      consented: null,
      declaredRuntimes: [],
    });
    await permissionConsentService.ensureConsent('ext.a', 'Ext A', 'review');
    expect(permissionConsentService.needsReview).toEqual([]);
  });

  it('revoke calls the IPC command and bumps consentVersion on success', async () => {
    revokeExtensionConsent.mockResolvedValue(true);
    const versionBefore = permissionConsentService.consentVersion;

    const result = await permissionConsentService.revoke('ext.a');

    expect(result).toBe(true);
    expect(revokeExtensionConsent).toHaveBeenCalledWith('ext.a');
    expect(permissionConsentService.consentVersion).toBe(versionBefore + 1);
  });

  it('revoke does not bump consentVersion when the IPC call fails', async () => {
    revokeExtensionConsent.mockResolvedValue(false);
    const versionBefore = permissionConsentService.consentVersion;

    const result = await permissionConsentService.revoke('ext.a');

    expect(result).toBe(false);
    expect(permissionConsentService.consentVersion).toBe(versionBefore);
  });

  it('ensureConsent never calls getRuntimeDownloadSizes when the extension declares no runtimes', async () => {
    checkExtensionConsent.mockResolvedValue({
      needsConsent: false,
      declaredPermissions: [],
      declaredArgs: {},
      consented: null,
      declaredRuntimes: [],
    });
    const result = await permissionConsentService.ensureConsent('ext.a', 'Ext A', 'enable');
    expect(result).toBe(true);
    expect(getRuntimeDownloadSizes).not.toHaveBeenCalled();
  });

  it('ensureConsent surfaces runtimeDownloads on the consent request when runtimes are declared', async () => {
    checkExtensionConsent.mockResolvedValue({
      needsConsent: true,
      declaredPermissions: ['network'],
      declaredArgs: {},
      consented: null,
      declaredRuntimes: ['bun'],
    });
    getRuntimeDownloadSizes.mockResolvedValue([{ name: 'bun', sizeBytes: 55_000_000 }]);

    const promise = permissionConsentService.ensureConsent('ext.a', 'Ext A', 'install');
    await vi.waitFor(() => {
      expect(permissionConsentService.activeRequest).not.toBeNull();
    });
    expect(getRuntimeDownloadSizes).toHaveBeenCalledWith(['bun']);
    expect(permissionConsentService.activeRequest?.runtimeDownloads).toEqual([
      { name: 'bun', sizeBytes: 55_000_000 },
    ]);
    permissionConsentService.onAccepted();
    await expect(promise).resolves.toBe(true);
  });

  it('ensureConsent prompts for a pending runtime download even when permission consent already covers', async () => {
    checkExtensionConsent.mockResolvedValue({
      needsConsent: false,
      declaredPermissions: ['network'],
      declaredArgs: {},
      consented: null,
      declaredRuntimes: ['bun'],
    });
    getRuntimeDownloadSizes.mockResolvedValue([{ name: 'bun', sizeBytes: 55_000_000 }]);

    const promise = permissionConsentService.ensureConsent('ext.a', 'Ext A', 'update');
    await vi.waitFor(() => {
      expect(permissionConsentService.activeRequest).not.toBeNull();
    });
    permissionConsentService.onAccepted();
    await expect(promise).resolves.toBe(true);
  });

  it('ensureConsent still marks reviewed when permissions already cover but the user declines a pending runtime download', async () => {
    // Permission consent and runtime consent are independent concerns: a
    // decline on the runtime half must not leave a permission-covered
    // extension stuck showing "needs review" forever.
    permissionConsentService.markNeedsReview('ext.a');
    checkExtensionConsent.mockResolvedValue({
      needsConsent: false,
      declaredPermissions: ['network'],
      declaredArgs: {},
      consented: null,
      declaredRuntimes: ['bun'],
    });
    getRuntimeDownloadSizes.mockResolvedValue([{ name: 'bun', sizeBytes: 55_000_000 }]);

    const promise = permissionConsentService.ensureConsent('ext.a', 'Ext A', 'review');
    await vi.waitFor(() => {
      expect(permissionConsentService.activeRequest).not.toBeNull();
    });
    permissionConsentService.onDeclined();

    await expect(promise).resolves.toBe(false);
    expect(permissionConsentService.needsReview).toEqual([]);
  });

  it('ensureConsent skips the prompt when consent already covers and every declared runtime is already installed', async () => {
    checkExtensionConsent.mockResolvedValue({
      needsConsent: false,
      declaredPermissions: ['network'],
      declaredArgs: {},
      consented: null,
      declaredRuntimes: ['bun'],
    });
    getRuntimeDownloadSizes.mockResolvedValue([]);

    const result = await permissionConsentService.ensureConsent('ext.a', 'Ext A', 'enable');
    expect(result).toBe(true);
    expect(permissionConsentService.activeRequest).toBeNull();
  });
});
