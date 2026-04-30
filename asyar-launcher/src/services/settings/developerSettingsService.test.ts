import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the settings service before importing the module under test
const mockCurrentSettings = vi.hoisted(() => ({
  developer: undefined as any,
}))

vi.mock('./settingsService.svelte', () => ({
  settingsService: {
    get currentSettings() {
      return mockCurrentSettings;
    },
  },
}))

vi.mock('../log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { DeveloperSettingsService } from './developerSettingsService.svelte'

describe('DeveloperSettingsService', () => {
  let svc: DeveloperSettingsService

  beforeEach(() => {
    svc = new DeveloperSettingsService()
    // Reset to no developer section (like a fresh install)
    mockCurrentSettings.developer = undefined
  })

  // ── isDeveloperMode ────────────────────────────────────────────────────

  describe('isDeveloperMode', () => {
    it('returns false when developer section is undefined', () => {
      mockCurrentSettings.developer = undefined
      expect(svc.isDeveloperMode).toBe(false)
    })

    it('returns false when developer.enabled is false', () => {
      mockCurrentSettings.developer = {
        enabled: false,
        showInspector: false,
        verboseLogging: false,
        tracing: false,
        allowSideloading: false,
      }
      expect(svc.isDeveloperMode).toBe(false)
    })

    it('returns true when developer.enabled is true', () => {
      mockCurrentSettings.developer = {
        enabled: true,
        showInspector: false,
        verboseLogging: false,
        tracing: false,
        allowSideloading: false,
      }
      expect(svc.isDeveloperMode).toBe(true)
    })
  })

  // ── showInspector ──────────────────────────────────────────────────────

  describe('showInspector', () => {
    it('returns false when developer mode is off', () => {
      mockCurrentSettings.developer = {
        enabled: false,
        showInspector: true,
        verboseLogging: false,
        tracing: false,
        allowSideloading: false,
      }
      expect(svc.showInspector).toBe(false)
    })

    it('returns false when developer mode is on but showInspector is off', () => {
      mockCurrentSettings.developer = {
        enabled: true,
        showInspector: false,
        verboseLogging: false,
        tracing: false,
        allowSideloading: false,
      }
      expect(svc.showInspector).toBe(false)
    })

    it('returns true when both developer mode and showInspector are on', () => {
      mockCurrentSettings.developer = {
        enabled: true,
        showInspector: true,
        verboseLogging: false,
        tracing: false,
        allowSideloading: false,
      }
      expect(svc.showInspector).toBe(true)
    })
  })

  // ── verboseLogging ─────────────────────────────────────────────────────

  describe('verboseLogging', () => {
    it('returns false when developer mode is off even if verboseLogging is true', () => {
      mockCurrentSettings.developer = {
        enabled: false,
        showInspector: false,
        verboseLogging: true,
        tracing: false,
        allowSideloading: false,
      }
      expect(svc.verboseLogging).toBe(false)
    })

    it('returns true when both developer mode and verboseLogging are on', () => {
      mockCurrentSettings.developer = {
        enabled: true,
        showInspector: false,
        verboseLogging: true,
        tracing: false,
        allowSideloading: false,
      }
      expect(svc.verboseLogging).toBe(true)
    })
  })

  // ── tracing ────────────────────────────────────────────────────────────

  describe('tracing', () => {
    it('returns false when developer mode is off', () => {
      mockCurrentSettings.developer = {
        enabled: false,
        showInspector: false,
        verboseLogging: false,
        tracing: true,
        allowSideloading: false,
      }
      expect(svc.tracing).toBe(false)
    })

    it('returns true when both developer mode and tracing are on', () => {
      mockCurrentSettings.developer = {
        enabled: true,
        showInspector: false,
        verboseLogging: false,
        tracing: true,
        allowSideloading: false,
      }
      expect(svc.tracing).toBe(true)
    })
  })

  // ── allowSideloading ───────────────────────────────────────────────────

  describe('allowSideloading', () => {
    it('returns false when developer mode is off', () => {
      mockCurrentSettings.developer = {
        enabled: false,
        showInspector: false,
        verboseLogging: false,
        tracing: false,
        allowSideloading: true,
      }
      expect(svc.allowSideloading).toBe(false)
    })

    it('returns true when both developer mode and allowSideloading are on', () => {
      mockCurrentSettings.developer = {
        enabled: true,
        showInspector: false,
        verboseLogging: false,
        tracing: false,
        allowSideloading: true,
      }
      expect(svc.allowSideloading).toBe(true)
    })

    it('returns false when developer section is undefined', () => {
      mockCurrentSettings.developer = undefined
      expect(svc.allowSideloading).toBe(false)
    })
  })
})
