/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/ipc/commands', () => ({
  checkExtensionConsent: vi.fn(),
  setExtensionConsent: vi.fn().mockResolvedValue(undefined),
  registerExtensionPermissions: vi
    .fn()
    .mockResolvedValue({ registered: true, needsConsent: false }),
}));
vi.mock('../log/logService', () => ({
  logService: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import * as commands from '../../lib/ipc/commands';
import { permissionConsentService } from './permissionConsentService.svelte';

const checkExtensionConsent = vi.mocked(commands.checkExtensionConsent);
const setExtensionConsent = vi.mocked(commands.setExtensionConsent);
const registerExtensionPermissions = vi.mocked(commands.registerExtensionPermissions);

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
    });

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
  });

  it('ensureConsent neither persists nor registers on decline', async () => {
    checkExtensionConsent.mockResolvedValue({
      needsConsent: true,
      declaredPermissions: ['network'],
      declaredArgs: {},
      consented: null,
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
    });
    await permissionConsentService.ensureConsent('ext.a', 'Ext A', 'review');
    expect(permissionConsentService.needsReview).toEqual([]);
  });
});
