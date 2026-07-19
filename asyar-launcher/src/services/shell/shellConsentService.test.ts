/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/ipc/shellCommands', () => ({
  shellCheckTrust: vi.fn().mockResolvedValue(false),
  shellGrantTrust: vi.fn().mockResolvedValue(true),
}));
vi.mock('../../lib/ipc/commands', () => ({
  showWindow: vi.fn().mockResolvedValue(undefined),
  setFocusLock: vi.fn().mockResolvedValue(undefined),
}));

import { shellCheckTrust, shellGrantTrust } from '../../lib/ipc/shellCommands';
import { showWindow, setFocusLock } from '../../lib/ipc/commands';
import { shellConsentService } from './shellConsentService.svelte';

const checkTrust = vi.mocked(shellCheckTrust);
const grantTrust = vi.mocked(shellGrantTrust);

/** requestConsent awaits shellCheckTrust before enqueueing; flush that hop. */
const settleMicrotasks = () => new Promise<void>((r) => setTimeout(r, 0));

describe('shellConsentService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkTrust.mockResolvedValue(false);
    grantTrust.mockResolvedValue(true);
  });

  it('short-circuits without a dialog when the binary is already trusted', async () => {
    checkTrust.mockResolvedValue(true);
    await expect(shellConsentService.requestConsent('ext.a', 'jq', '/usr/bin/jq')).resolves.toBe(
      true,
    );
    expect(shellConsentService.activeRequest).toBeNull();
  });

  it('does not reveal or focus-lock the launcher on the already-trusted hot path', async () => {
    checkTrust.mockResolvedValue(true);
    await shellConsentService.requestConsent('ext.a', 'jq', '/usr/bin/jq');
    expect(showWindow).not.toHaveBeenCalled();
    expect(setFocusLock).not.toHaveBeenCalled();
  });

  it('reveals and focus-locks the launcher when a dialog opens, releasing on settle', async () => {
    const promise = shellConsentService.requestConsent('ext.a', 'jq', '/usr/bin/jq');
    await settleMicrotasks();
    // Dialog is up: a background command may have hidden the launcher, so it
    // is re-shown and held open.
    expect(showWindow).toHaveBeenCalledTimes(1);
    expect(setFocusLock).toHaveBeenLastCalledWith(true);

    await shellConsentService.denyCurrent();
    await expect(promise).resolves.toBe(false);
    // Queue drained → the hold is released.
    expect(setFocusLock).toHaveBeenLastCalledWith(false);
  });

  it('approve grants trust and resolves true', async () => {
    const promise = shellConsentService.requestConsent('ext.a', 'jq', '/usr/bin/jq');
    await settleMicrotasks();
    expect(shellConsentService.activeRequest?.resolvedPath).toBe('/usr/bin/jq');

    await shellConsentService.approveCurrent();
    await expect(promise).resolves.toBe(true);
    expect(grantTrust).toHaveBeenCalledWith('ext.a', '/usr/bin/jq');
    expect(shellConsentService.activeRequest).toBeNull();
  });

  it('deny resolves false without granting trust', async () => {
    const promise = shellConsentService.requestConsent('ext.a', 'jq', '/usr/bin/jq');
    await settleMicrotasks();

    await shellConsentService.denyCurrent();
    await expect(promise).resolves.toBe(false);
    expect(grantTrust).not.toHaveBeenCalled();
  });

  it('deduplicates concurrent requests for the same extension+binary pair', async () => {
    const first = shellConsentService.requestConsent('ext.a', 'jq', '/usr/bin/jq');
    await settleMicrotasks();
    const second = shellConsentService.requestConsent('ext.a', 'jq', '/usr/bin/jq');
    await settleMicrotasks();

    await shellConsentService.approveCurrent();
    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(true);
    // One dialog, one grant — the second call latched onto the first request.
    expect(grantTrust).toHaveBeenCalledTimes(1);
    expect(shellConsentService.activeRequest).toBeNull();
  });

  it('queues a second distinct request instead of clobbering the first', async () => {
    const first = shellConsentService.requestConsent('ext.a', 'jq', '/usr/bin/jq');
    await settleMicrotasks();
    const second = shellConsentService.requestConsent('ext.b', 'rg', '/usr/bin/rg');
    await settleMicrotasks();

    // First stays active; second waits behind it.
    expect(shellConsentService.activeRequest?.extensionId).toBe('ext.a');

    await shellConsentService.approveCurrent();
    await expect(first).resolves.toBe(true);

    expect(shellConsentService.activeRequest?.extensionId).toBe('ext.b');
    await shellConsentService.denyCurrent();
    await expect(second).resolves.toBe(false);
    expect(shellConsentService.activeRequest).toBeNull();
  });

  it('prompts again for the same pair after a denial (dedup entry cleared)', async () => {
    const first = shellConsentService.requestConsent('ext.a', 'jq', '/usr/bin/jq');
    await settleMicrotasks();
    await shellConsentService.denyCurrent();
    await expect(first).resolves.toBe(false);

    const retry = shellConsentService.requestConsent('ext.a', 'jq', '/usr/bin/jq');
    await settleMicrotasks();
    expect(shellConsentService.activeRequest?.resolvedPath).toBe('/usr/bin/jq');
    await shellConsentService.approveCurrent();
    await expect(retry).resolves.toBe(true);
  });
});
