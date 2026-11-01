// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(null),
}));

vi.mock('@tauri-apps/api/event', () => ({
  emit: vi.fn().mockResolvedValue(undefined),
  listen: vi.fn().mockResolvedValue(() => {}),
}));

vi.mock('@tauri-apps/api/app', () => ({
  getVersion: vi.fn().mockResolvedValue('0.1.0'),
}));

vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-os', () => ({
  hostname: vi.fn().mockResolvedValue('test-machine'),
}));

vi.mock('../../../services/auth/authService.svelte', () => {
  let entitlements = ['sync:settings'];
  let isLoggedIn = true;
  return {
    authService: {
      get isLoggedIn() {
        return isLoggedIn;
      },
      set isLoggedIn(v: boolean) {
        isLoggedIn = v;
      },
      get entitlements() {
        return entitlements;
      },
      set entitlements(v: string[]) {
        entitlements = v;
      },
      user: {
        name: 'Test User',
        email: 'test@example.com',
      },
      refreshEntitlements: vi.fn().mockResolvedValue(undefined),
      logout: vi.fn().mockResolvedValue(undefined),
      startLogin: vi.fn().mockResolvedValue(undefined),
      cancelLoginPolling: vi.fn(),
    },
  };
});

vi.mock('../../../services/sync/cloudSyncService.svelte', () => {
  let enabled = true;
  let status: 'idle' | 'syncing' | 'error' | 'not_entitled' | 'quota_exceeded' = 'idle';
  let lastSyncedAt: Date | null = new Date();
  let lastError: string | null = null;
  let quota: { usedBytes: number; limitBytes: number } | null = null;
  let isTransient = false;

  return {
    cloudSyncService: {
      get enabled() {
        return enabled;
      },
      set enabled(v: boolean) {
        enabled = v;
      },
      get status() {
        return status;
      },
      set status(v: any) {
        status = v;
      },
      get lastSyncedAt() {
        return lastSyncedAt;
      },
      set lastSyncedAt(v: Date | null) {
        lastSyncedAt = v;
      },
      get lastError() {
        return lastError;
      },
      set lastError(v: string | null) {
        lastError = v;
      },
      get quota() {
        return quota;
      },
      set quota(v: { usedBytes: number; limitBytes: number } | null) {
        quota = v;
      },
      get isTransient() {
        return isTransient;
      },
      set isTransient(v: boolean) {
        isTransient = v;
      },
      syncNow: vi.fn().mockResolvedValue(undefined),
      resetAndSync: vi.fn().mockResolvedValue(undefined),
    },
  };
});

vi.mock('../../../services/sync/syncEncryptionService.svelte', () => {
  let enabled = false;
  let locked = false;
  let mode: string | null = null;
  let keystoreIsOsBacked = true;
  let incomingPairings: any[] = [];
  return {
    syncEncryptionService: {
      get enabled() {
        return enabled;
      },
      set enabled(v: boolean) {
        enabled = v;
      },
      get locked() {
        return locked;
      },
      set locked(v: boolean) {
        locked = v;
      },
      get mode() {
        return mode;
      },
      set mode(v: string | null) {
        mode = v;
      },
      get keystoreIsOsBacked() {
        return keystoreIsOsBacked;
      },
      set keystoreIsOsBacked(v: boolean) {
        keystoreIsOsBacked = v;
      },
      get incomingPairings() {
        return incomingPairings;
      },
      set incomingPairings(v: any[]) {
        incomingPairings = v;
      },
      enrol: vi.fn(),
      unlock: vi.fn(),
      unlockWithPhrase: vi.fn(),
      refreshStatus: vi.fn().mockResolvedValue(undefined),
      checkIncomingPairings: vi.fn().mockResolvedValue([]),
      approvePairing: vi.fn(),
      cancelPairing: vi.fn(),
      reset: vi.fn().mockResolvedValue(undefined),
    },
  };
});

vi.mock('../../../services/settings/settingsService.svelte', () => ({
  settingsService: {
    getSettings: vi.fn(() => ({
      user: { syncEnabled: true },
    })),
    updateSetting: vi.fn(),
  },
}));

import AccountTab from './AccountTab.svelte';
import { authService } from '../../../services/auth/authService.svelte';
import { cloudSyncService } from '../../../services/sync/cloudSyncService.svelte';
import { syncEncryptionService } from '../../../services/sync/syncEncryptionService.svelte';
import type { SettingsHandler } from '../settingsHandlers.svelte';

function createMockHandler(): SettingsHandler {
  return {
    settings: {
      user: { syncEnabled: true },
    },
    activeTab: 'account',
  } as unknown as SettingsHandler;
}

describe('AccountTab sync section hardening', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authService.isLoggedIn = true;
    authService.entitlements = ['sync:settings'];
    cloudSyncService.status = 'idle';
    cloudSyncService.lastSyncedAt = new Date();
    cloudSyncService.lastError = null;
    cloudSyncService.quota = null;
    cloudSyncService.isTransient = false;
    syncEncryptionService.enabled = false;
    syncEncryptionService.locked = false;
    syncEncryptionService.mode = null;
    syncEncryptionService.keystoreIsOsBacked = true;
  });

  it('not-entitled branch displays accurate explanation with NO upgrade links or buttons', () => {
    authService.isLoggedIn = true;
    authService.entitlements = []; // no sync:settings

    const { container } = render(AccountTab, { props: { handler: createMockHandler() } });

    expect(
      screen.getByText(
        /Cloud Sync requires an active plan\. Data on this device is unaffected\. Data already stored in the cloud is kept for a limited time and will then be removed\./i,
      ),
    ).toBeTruthy();

    // Verify no upsell button or pricing link exists in the sync section
    const syncSection = container.querySelector('#account-sync');
    expect(syncSection).not.toBeNull();
    const buttons = syncSection?.querySelectorAll('button') ?? [];
    expect(buttons.length).toBe(0);
    const links = syncSection?.querySelectorAll('a') ?? [];
    expect(links.length).toBe(0);
  });

  it('displays quota-exceeded message with readable MB formatted numbers', () => {
    authService.isLoggedIn = true;
    authService.entitlements = ['sync:settings'];
    cloudSyncService.status = 'quota_exceeded';
    cloudSyncService.quota = {
      usedBytes: 15_000_000,
      limitBytes: 10_000_000,
    };

    render(AccountTab, { props: { handler: createMockHandler() } });

    expect(
      screen.getByText(
        /Sync storage quota exceeded \(15(?:\.0)? MB \/ 10(?:\.0)? MB\)\. Delete items to free up space\./i,
      ),
    ).toBeTruthy();
  });

  it('displays generic quota-exceeded message when limitBytes is zero or missing', () => {
    authService.isLoggedIn = true;
    authService.entitlements = ['sync:settings'];
    cloudSyncService.status = 'quota_exceeded';
    cloudSyncService.quota = {
      usedBytes: 0,
      limitBytes: 0,
    };

    render(AccountTab, { props: { handler: createMockHandler() } });

    expect(
      screen.getByText(/^Sync storage quota exceeded\. Delete items to free up space\.$/i),
    ).toBeTruthy();
  });

  it('displays friendly transient line instead of raw error string', () => {
    authService.isLoggedIn = true;
    authService.entitlements = ['sync:settings'];
    cloudSyncService.isTransient = true;
    cloudSyncService.status = 'error';
    cloudSyncService.lastError = null;

    render(AccountTab, { props: { handler: createMockHandler() } });

    expect(screen.getByText(/Couldn't reach Asyar Cloud, will retry/i)).toBeTruthy();
  });

  it('preserves E2EE rows and badges when entitled and sync enabled', () => {
    authService.isLoggedIn = true;
    authService.entitlements = ['sync:settings'];

    render(AccountTab, { props: { handler: createMockHandler() } });

    expect(screen.getByText('Encrypted Sync')).toBeTruthy();
    expect(screen.getByText('Server can read your synced data.')).toBeTruthy();
  });

  it('renders locked card for locked device-key accounts', () => {
    authService.isLoggedIn = true;
    authService.entitlements = ['sync:settings'];
    syncEncryptionService.enabled = true;
    syncEncryptionService.locked = true;
    syncEncryptionService.mode = 'device-key';

    render(AccountTab, { props: { handler: createMockHandler() } });

    expect(
      screen.getAllByText("This device can't read your synced data yet").length,
    ).toBeGreaterThan(0);
    expect(screen.getByText('Enter recovery phrase')).toBeTruthy();
    expect(screen.getByText('Approve from another device')).toBeTruthy();
  });

  it('renders keychain status line and no disable toggle for unlocked device-key accounts', () => {
    authService.isLoggedIn = true;
    authService.entitlements = ['sync:settings'];
    syncEncryptionService.enabled = true;
    syncEncryptionService.locked = false;
    syncEncryptionService.mode = 'device-key';
    syncEncryptionService.keystoreIsOsBacked = true;

    render(AccountTab, { props: { handler: createMockHandler() } });

    expect(screen.getByText('Key stored in your system keychain')).toBeTruthy();
    expect(screen.getByText('Reset Cloud Sync')).toBeTruthy();
    expect(screen.getByText('Show')).toBeTruthy();
  });

  it('renders file storage status line when keystore is not OS backed', () => {
    authService.isLoggedIn = true;
    authService.entitlements = ['sync:settings'];
    syncEncryptionService.enabled = true;
    syncEncryptionService.locked = false;
    syncEncryptionService.mode = 'device-key';
    syncEncryptionService.keystoreIsOsBacked = false;

    render(AccountTab, { props: { handler: createMockHandler() } });

    expect(
      screen.getByText('Key stored in a file on this device, not the system keychain'),
    ).toBeTruthy();
  });
});
