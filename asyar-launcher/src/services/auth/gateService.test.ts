import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./authService.svelte', () => ({
  authService: {
    isLoggedIn: false,
    entitlements: [],
  },
}));

vi.mock('../settings/settingsService.svelte', () => ({
  settingsService: {
    getSettings: vi.fn(),
  },
}));

import { gate } from './gateService.svelte';
import { authService } from './authService.svelte';
import { settingsService } from '../settings/settingsService.svelte';
import type { AppSettings } from '../settings/types/AppSettingsType';

function mockSettings(partial: Partial<AppSettings>): void {
  const defaults: AppSettings = {
    general: { startAtLogin: false, showDockIcon: false, showTrayIcon: true },
    search: {
      searchApplications: true,
      searchSystemPreferences: true,
      fuzzySearch: true,
      enableExtensionSearch: false,
      allowExtensionActions: false,
      additionalScanPaths: [],
      applicationEnabled: {},
    },
    shortcut: { modifier: 'Alt', key: 'Space' },
    appearance: { theme: 'system', launchView: 'default', windowWidth: 800, windowHeight: 600 },
    extensions: { enabled: {}, autoUpdate: true },
    onboarding: { completed: true },
    privacy: { crashReportMode: 'off', usageShareMode: 'off' },
    user: { syncEnabled: true },
    ai: {
      providers: {},
      temperature: 0.7,
      maxTokens: 2048,
      defaultAgentId: null,
      tabContinuesLastThread: false,
    },
    fileSearch: { enabled: true, includeRoots: [], excludePatterns: [], indexHidden: false },
  };
  vi.mocked(settingsService.getSettings).mockReturnValue({
    ...defaults,
    ...partial,
    privacy: { ...defaults.privacy, ...(partial.privacy ?? {}) },
    user: { ...defaults.user, ...(partial.user ?? {}) },
  });
}

describe('GateService (Centralized Policy Engine)', () => {
  beforeEach(() => {
    authService.isLoggedIn = false;
    authService.entitlements = [];
    mockSettings({});
  });

  describe('Cloud Sync Egress (sync.egress)', () => {
    it('fails closed when signed out', () => {
      authService.isLoggedIn = false;
      authService.entitlements = ['sync:settings'];
      mockSettings({ user: { syncEnabled: true } });

      expect(gate.allows('sync.egress')).toBe(false);
      expect(gate.denies('sync.egress')).toBe(true);
      expect(gate.gate('sync.egress')).toEqual({
        allowed: false,
        reason: 'Cloud sync requires a signed-in account.',
      });
      expect(() => gate.authorize('sync.egress')).toThrow('signed-in account');
    });

    it('fails closed when signed in without entitlement', () => {
      authService.isLoggedIn = true;
      authService.entitlements = [];
      mockSettings({ user: { syncEnabled: true } });

      expect(gate.allows('sync.egress')).toBe(false);
      expect(gate.gate('sync.egress')).toEqual({
        allowed: false,
        reason: 'Cloud sync requires an active subscription with the sync:settings entitlement.',
      });
    });

    it('fails closed when signed in and entitled but disabled in settings', () => {
      authService.isLoggedIn = true;
      authService.entitlements = ['sync:settings'];
      mockSettings({ user: { syncEnabled: false } });

      expect(gate.allows('sync.egress')).toBe(false);
      expect(gate.gate('sync.egress')).toEqual({
        allowed: false,
        reason: 'Cloud sync is disabled in settings.',
      });
    });

    it('allows when signed in, entitled, and enabled', () => {
      authService.isLoggedIn = true;
      authService.entitlements = ['sync:settings'];
      mockSettings({ user: { syncEnabled: true } });

      expect(gate.allows('sync.egress')).toBe(true);
      expect(gate.denies('sync.egress')).toBe(false);
      expect(gate.gate('sync.egress')).toEqual({ allowed: true });
      expect(() => gate.authorize('sync.egress')).not.toThrow();
    });
  });

  describe('Telemetry Abilities', () => {
    it('telemetry.crash-report respects privacy.crashReportMode', () => {
      mockSettings({ privacy: { crashReportMode: 'off', usageShareMode: 'off' } });
      expect(gate.allows('telemetry.crash-report')).toBe(false);

      mockSettings({ privacy: { crashReportMode: 'auto', usageShareMode: 'off' } });
      expect(gate.allows('telemetry.crash-report')).toBe(true);

      mockSettings({ privacy: { crashReportMode: 'ask', usageShareMode: 'off' } });
      expect(gate.allows('telemetry.crash-report')).toBe(true);
    });

    it('telemetry.usage-metrics respects privacy.usageShareMode', () => {
      mockSettings({ privacy: { crashReportMode: 'off', usageShareMode: 'off' } });
      expect(gate.allows('telemetry.usage-metrics')).toBe(false);

      mockSettings({ privacy: { crashReportMode: 'off', usageShareMode: 'anonymous' } });
      expect(gate.allows('telemetry.usage-metrics')).toBe(true);
    });
  });

  describe('AI Cloud Models', () => {
    it('requires active subscription and authentication', () => {
      authService.isLoggedIn = false;
      expect(gate.allows('ai.cloud-models')).toBe(false);

      authService.isLoggedIn = true;
      authService.entitlements = [];
      expect(gate.allows('ai.cloud-models')).toBe(false);

      authService.entitlements = ['ai:advanced-models'];
      expect(gate.allows('ai.cloud-models')).toBe(true);
    });
  });
});
