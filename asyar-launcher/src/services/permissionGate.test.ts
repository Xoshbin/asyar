import { describe, it, expect } from 'vitest'
import { checkPermission, PERMISSION_MAP } from './permissionGate'

describe('checkPermission', () => {

  // ── Unknown / unmapped call types ────────────────────────────────────────

  describe('unmapped call types', () => {
    it('allows a call type that is not in PERMISSION_MAP', () => {
      const result = checkPermission('my-ext', 'asyar:core:someUnknownCall', [])
      expect(result.allowed).toBe(true)
    })

    it('allows an empty call type string', () => {
      const result = checkPermission('my-ext', '', [])
      expect(result.allowed).toBe(true)
    })

    it('does not set requiredPermission for unmapped calls', () => {
      const result = checkPermission('my-ext', 'asyar:core:unknown', [])
      expect(result.requiredPermission).toBeUndefined()
    })
  })

  // ── Clipboard ─────────────────────────────────────────────────────────────

  describe('clipboard:read', () => {
    it('allows readCurrentClipboard when clipboard:read is declared', () => {
      expect(checkPermission('ext', 'asyar:api:clipboard:readCurrentClipboard', ['clipboard:read']).allowed).toBe(true)
    })

    it('allows getRecentItems when clipboard:read is declared', () => {
      expect(checkPermission('ext', 'asyar:api:clipboard:getRecentItems', ['clipboard:read']).allowed).toBe(true)
    })

    it('allows readCurrentText when clipboard:read is declared', () => {
      expect(checkPermission('ext', 'asyar:api:clipboard:readCurrentText', ['clipboard:read']).allowed).toBe(true)
    })

    it('denies readCurrentText when no permissions declared', () => {
      const result = checkPermission('ext', 'asyar:api:clipboard:readCurrentText', [])
      expect(result.allowed).toBe(false)
      expect(result.requiredPermission).toBe('clipboard:read')
    })

    it('denies readCurrentClipboard when no permissions declared', () => {
      const result = checkPermission('my-ext', 'asyar:api:clipboard:readCurrentClipboard', [])
      expect(result.allowed).toBe(false)
      expect(result.requiredPermission).toBe('clipboard:read')
    })

    it('denies readCurrentClipboard when only clipboard:write is declared', () => {
      const result = checkPermission('my-ext', 'asyar:api:clipboard:readCurrentClipboard', ['clipboard:write'])
      expect(result.allowed).toBe(false)
    })
  })

  describe('clipboard:write', () => {
    const writeOps = [
      'asyar:api:clipboard:writeToClipboard',
      'asyar:api:clipboard:pasteItem',
      'asyar:api:clipboard:simulatePaste',
      'asyar:api:clipboard:toggleItemFavorite',
      'asyar:api:clipboard:deleteItem',
      'asyar:api:clipboard:clearNonFavorites',
    ]

    it.each(writeOps)('allows %s when clipboard:write is declared', (op) => {
      expect(checkPermission('ext', op, ['clipboard:write']).allowed).toBe(true)
    })

    it.each(writeOps)('denies %s when no permissions declared', (op) => {
      const result = checkPermission('ext', op, [])
      expect(result.allowed).toBe(false)
      expect(result.requiredPermission).toBe('clipboard:write')
    })
  })

  // ── Notifications ─────────────────────────────────────────────────────────

  describe('notifications:send', () => {
    it('allows send when notifications:send is declared', () => {
      expect(checkPermission('ext', 'asyar:api:notifications:send', ['notifications:send']).allowed).toBe(true)
    })

    it('allows dismiss when notifications:send is declared', () => {
      expect(checkPermission('ext', 'asyar:api:notifications:dismiss', ['notifications:send']).allowed).toBe(true)
    })

    it('denies send when not declared', () => {
      const result = checkPermission('ext', 'asyar:api:notifications:send', [])
      expect(result.allowed).toBe(false)
      expect(result.requiredPermission).toBe('notifications:send')
    })

    it('denies dismiss when not declared', () => {
      const result = checkPermission('ext', 'asyar:api:notifications:dismiss', [])
      expect(result.allowed).toBe(false)
      expect(result.requiredPermission).toBe('notifications:send')
    })
  })

  // ── shell:spawn (highest-risk permission) ───────────────────────────────

  describe('shell:spawn', () => {
    it('denies raw Tauri invoke without shell:spawn', () => {
      const result = checkPermission('dangerous-ext', 'asyar:api:invoke', [])
      expect(result.allowed).toBe(false)
      expect(result.requiredPermission).toBe('shell:spawn')
    })

    it('allows raw Tauri invoke when shell:spawn is declared', () => {
      expect(checkPermission('trusted-ext', 'asyar:api:invoke', ['shell:spawn']).allowed).toBe(true)
    })

    it('denies with clipboard:read but not shell:spawn', () => {
      const result = checkPermission('ext', 'asyar:api:invoke', ['clipboard:read', 'network'])
      expect(result.allowed).toBe(false)
    })

    it('denies shell:spawn wire type without shell:spawn', () => {
      const result = checkPermission('ext', 'asyar:api:shell:spawn', [])
      expect(result.allowed).toBe(false)
      expect(result.requiredPermission).toBe('shell:spawn')
    })

    it('allows shell:spawn wire type when shell:spawn is declared', () => {
      expect(checkPermission('ext', 'asyar:api:shell:spawn', ['shell:spawn']).allowed).toBe(true)
    })
  })

  // ── Network ───────────────────────────────────────────────────────────────

  describe('network', () => {
    it('denies network fetch without network permission', () => {
      const result = checkPermission('ext', 'asyar:api:network:fetch', [])
      expect(result.allowed).toBe(false)
      expect(result.requiredPermission).toBe('network')
    })

    it('allows network fetch when network is declared', () => {
      expect(checkPermission('ext', 'asyar:api:network:fetch', ['network']).allowed).toBe(true)
    })
  })

  // ── Denial reason message quality ─────────────────────────────────────────

  describe('denial reason message', () => {
    it('includes the extension ID', () => {
      const result = checkPermission('pomodoro-timer', 'asyar:api:clipboard:readCurrentClipboard', [])
      expect(result.reason).toContain('pomodoro-timer')
    })

    it('includes the call type', () => {
      const result = checkPermission('ext', 'asyar:api:clipboard:readCurrentClipboard', [])
      expect(result.reason).toContain('asyar:api:clipboard:readCurrentClipboard')
    })

    it('includes the required permission name', () => {
      const result = checkPermission('ext', 'asyar:api:clipboard:readCurrentClipboard', [])
      expect(result.reason).toContain('clipboard:read')
    })

    it('does not set reason for allowed calls', () => {
      const result = checkPermission('ext', 'asyar:api:clipboard:readCurrentClipboard', ['clipboard:read'])
      expect(result.reason).toBeUndefined()
    })
  })

  describe('application (canonical namespace)', () => {
    it('blocks getFrontmostApplication without application:read', () => {
      const result = checkPermission('test-ext', 'asyar:api:application:getFrontmostApplication', [])
      expect(result.allowed).toBe(false)
      expect(result.requiredPermission).toBe('application:read')
    })

    it('allows getFrontmostApplication with application:read', () => {
      const result = checkPermission('test-ext', 'asyar:api:application:getFrontmostApplication', ['application:read'])
      expect(result.allowed).toBe(true)
    })

    it('blocks syncApplicationIndex without application:read', () => {
      const result = checkPermission('test-ext', 'asyar:api:application:syncApplicationIndex', [])
      expect(result.allowed).toBe(false)
      expect(result.requiredPermission).toBe('application:read')
    })

    it('allows syncApplicationIndex with application:read', () => {
      const result = checkPermission('test-ext', 'asyar:api:application:syncApplicationIndex', ['application:read'])
      expect(result.allowed).toBe(true)
    })

    it('blocks listApplications without application:read', () => {
      const result = checkPermission('test-ext', 'asyar:api:application:listApplications', [])
      expect(result.allowed).toBe(false)
      expect(result.requiredPermission).toBe('application:read')
    })

    it('allows listApplications with application:read', () => {
      const result = checkPermission('test-ext', 'asyar:api:application:listApplications', ['application:read'])
      expect(result.allowed).toBe(true)
    })
  })

  describe('window (canonical namespace)', () => {
    it('blocks getWindowBounds without window:manage', () => {
      const result = checkPermission('test-ext', 'asyar:api:window:getWindowBounds', [])
      expect(result.allowed).toBe(false)
      expect(result.requiredPermission).toBe('window:manage')
    })

    it('allows getWindowBounds with window:manage', () => {
      const result = checkPermission('test-ext', 'asyar:api:window:getWindowBounds', ['window:manage'])
      expect(result.allowed).toBe(true)
    })

    it('blocks setWindowBounds without window:manage', () => {
      const result = checkPermission('test-ext', 'asyar:api:window:setWindowBounds', [])
      expect(result.allowed).toBe(false)
      expect(result.requiredPermission).toBe('window:manage')
    })

    it('allows setWindowBounds with window:manage', () => {
      const result = checkPermission('test-ext', 'asyar:api:window:setWindowBounds', ['window:manage'])
      expect(result.allowed).toBe(true)
    })

    it('blocks setFullscreen without window:manage', () => {
      const result = checkPermission('test-ext', 'asyar:api:window:setFullscreen', [])
      expect(result.allowed).toBe(false)
      expect(result.requiredPermission).toBe('window:manage')
    })

    it('allows setFullscreen with window:manage', () => {
      const result = checkPermission('test-ext', 'asyar:api:window:setFullscreen', ['window:manage'])
      expect(result.allowed).toBe(true)
    })
  })

  describe('fs (canonical namespace)', () => {
    it('blocks fs:showInFileManager without fs:read', () => {
      const result = checkPermission('test-ext', 'asyar:api:fs:showInFileManager', [])
      expect(result.allowed).toBe(false)
      expect(result.requiredPermission).toBe('fs:read')
    })

    it('allows fs:showInFileManager with fs:read', () => {
      const result = checkPermission('test-ext', 'asyar:api:fs:showInFileManager', ['fs:read'])
      expect(result.allowed).toBe(true)
    })

    it('blocks fs:trash without fs:write', () => {
      const result = checkPermission('test-ext', 'asyar:api:fs:trash', [])
      expect(result.allowed).toBe(false)
      expect(result.requiredPermission).toBe('fs:write')
    })

    it('allows fs:trash with fs:write', () => {
      const result = checkPermission('test-ext', 'asyar:api:fs:trash', ['fs:write'])
      expect(result.allowed).toBe(true)
    })
  })

  // ── PERMISSION_MAP structure ───────────────────────────────────────────────

  // ── OAuth ─────────────────────────────────────────────────────────────────

  describe('entitlements:read', () => {
    it('allows entitlements:check when entitlements:read is declared', () => {
      expect(checkPermission('ext', 'asyar:api:entitlements:check', ['entitlements:read']).allowed).toBe(true)
    })
    it('denies entitlements:check when not declared', () => {
      const result = checkPermission('ext', 'asyar:api:entitlements:check', [])
      expect(result.allowed).toBe(false)
      expect(result.requiredPermission).toBe('entitlements:read')
    })
    it('denies entitlements:getAll when not declared', () => {
      const result = checkPermission('ext', 'asyar:api:entitlements:getAll', [])
      expect(result.allowed).toBe(false)
      expect(result.requiredPermission).toBe('entitlements:read')
    })
  })

  describe('oauth:use', () => {
    it('denies oauth:authorize without oauth:use', () => {
      const result = checkPermission('ext', 'asyar:api:oauth:authorize', [])
      expect(result.allowed).toBe(false)
      expect(result.requiredPermission).toBe('oauth:use')
    })

    it('allows oauth:authorize when oauth:use is declared', () => {
      expect(checkPermission('ext', 'asyar:api:oauth:authorize', ['oauth:use']).allowed).toBe(true)
    })

    it('denies oauth:revokeToken without oauth:use', () => {
      const result = checkPermission('ext', 'asyar:api:oauth:revokeToken', [])
      expect(result.allowed).toBe(false)
      expect(result.requiredPermission).toBe('oauth:use')
    })

    it('allows oauth:revokeToken when oauth:use is declared', () => {
      expect(checkPermission('ext', 'asyar:api:oauth:revokeToken', ['oauth:use']).allowed).toBe(true)
    })
  })

  describe('extension:invoke', () => {
    it('denies interop:launchCommand without extension:invoke', () => {
      const result = checkPermission('ext', 'asyar:api:interop:launchCommand', [])
      expect(result.allowed).toBe(false)
      expect(result.requiredPermission).toBe('extension:invoke')
    })

    it('allows interop:launchCommand when extension:invoke is declared', () => {
      expect(checkPermission('ext', 'asyar:api:interop:launchCommand', ['extension:invoke']).allowed).toBe(true)
    })
  })

  describe('selection:read', () => {
    it('allows selection:getSelectedText with selection:read', () => {
      expect(checkPermission('ext', 'asyar:api:selection:getSelectedText', ['selection:read']).allowed).toBe(true)
    })
    it('denies selection:getSelectedText without selection:read', () => {
      const result = checkPermission('ext', 'asyar:api:selection:getSelectedText', [])
      expect(result.allowed).toBe(false)
      expect(result.requiredPermission).toBe('selection:read')
    })
    it('denies selection:getSelectedFinderItems without selection:read', () => {
      const result = checkPermission('ext', 'asyar:api:selection:getSelectedFinderItems', [])
      expect(result.allowed).toBe(false)
      expect(result.requiredPermission).toBe('selection:read')
    })
  })

  describe('preferences:read/write', () => {
    it('allows preferences:getAll with preferences:read', () => {
      expect(checkPermission('ext', 'asyar:api:preferences:getAll', ['preferences:read']).allowed).toBe(true)
    })
    it('denies preferences:getAll without preferences:read', () => {
      const r = checkPermission('ext', 'asyar:api:preferences:getAll', [])
      expect(r.allowed).toBe(false)
      expect(r.requiredPermission).toBe('preferences:read')
    })
    it('allows preferences:set with preferences:write', () => {
      expect(checkPermission('ext', 'asyar:api:preferences:set', ['preferences:write']).allowed).toBe(true)
    })
    it('denies preferences:set without preferences:write', () => {
      const r = checkPermission('ext', 'asyar:api:preferences:set', [])
      expect(r.allowed).toBe(false)
      expect(r.requiredPermission).toBe('preferences:write')
    })
    it('denies preferences:reset without preferences:write', () => {
      const r = checkPermission('ext', 'asyar:api:preferences:reset', [])
      expect(r.allowed).toBe(false)
      expect(r.requiredPermission).toBe('preferences:write')
    })
  })

  describe('power:inhibit', () => {
    it('maps keepAwake to power:inhibit', () => {
      expect(PERMISSION_MAP['asyar:api:power:keepAwake']).toBe('power:inhibit')
    })
    it('maps release to power:inhibit', () => {
      expect(PERMISSION_MAP['asyar:api:power:release']).toBe('power:inhibit')
    })
    it('maps list to power:inhibit', () => {
      expect(PERMISSION_MAP['asyar:api:power:list']).toBe('power:inhibit')
    })
    it('denies keepAwake without power:inhibit', () => {
      const r = checkPermission('ext', 'asyar:api:power:keepAwake', [])
      expect(r.allowed).toBe(false)
      expect(r.requiredPermission).toBe('power:inhibit')
    })
    it('allows keepAwake with power:inhibit', () => {
      expect(checkPermission('ext', 'asyar:api:power:keepAwake', ['power:inhibit']).allowed).toBe(true)
    })
  })

  describe('systemEvents:read', () => {
    it('allows subscribe when systemEvents:read is declared', () => {
      const r = checkPermission('ext', 'asyar:api:systemEvents:subscribe', ['systemEvents:read'])
      expect(r.allowed).toBe(true)
    })
    it('denies subscribe when no permissions are declared', () => {
      const r = checkPermission('ext', 'asyar:api:systemEvents:subscribe', [])
      expect(r.allowed).toBe(false)
      expect(r.requiredPermission).toBe('systemEvents:read')
    })
    it('allows unsubscribe when systemEvents:read is declared', () => {
      const r = checkPermission('ext', 'asyar:api:systemEvents:unsubscribe', ['systemEvents:read'])
      expect(r.allowed).toBe(true)
    })
    it('denies subscribe when only an unrelated permission is declared', () => {
      const r = checkPermission('ext', 'asyar:api:systemEvents:subscribe', ['power:inhibit'])
      expect(r.allowed).toBe(false)
    })
  })

  describe('app:frontmost-watch', () => {
    it('allows appEvents:subscribe when app:frontmost-watch is declared', () => {
      const r = checkPermission('ext', 'asyar:api:appEvents:subscribe', ['app:frontmost-watch'])
      expect(r.allowed).toBe(true)
    })
    it('denies appEvents:subscribe when no permissions are declared', () => {
      const r = checkPermission('ext', 'asyar:api:appEvents:subscribe', [])
      expect(r.allowed).toBe(false)
      expect(r.requiredPermission).toBe('app:frontmost-watch')
    })
    it('allows appEvents:unsubscribe when app:frontmost-watch is declared', () => {
      const r = checkPermission('ext', 'asyar:api:appEvents:unsubscribe', ['app:frontmost-watch'])
      expect(r.allowed).toBe(true)
    })
    it('denies appEvents:subscribe when only application:read is declared (namespace boundary)', () => {
      // application:read gates queries; subscriptions need app:frontmost-watch.
      const r = checkPermission('ext', 'asyar:api:appEvents:subscribe', ['application:read'])
      expect(r.allowed).toBe(false)
    })
  })

  describe('application:isRunning', () => {
    it('allows isRunning when application:read is declared', () => {
      const r = checkPermission('ext', 'asyar:api:application:isRunning', ['application:read'])
      expect(r.allowed).toBe(true)
    })
    it('denies isRunning when no permissions are declared', () => {
      const r = checkPermission('ext', 'asyar:api:application:isRunning', [])
      expect(r.allowed).toBe(false)
      expect(r.requiredPermission).toBe('application:read')
    })
    it('denies isRunning when only app:frontmost-watch is declared (namespace boundary)', () => {
      // application:isRunning is a query, not a subscription.
      const r = checkPermission('ext', 'asyar:api:application:isRunning', ['app:frontmost-watch'])
      expect(r.allowed).toBe(false)
    })
  })

  describe('timers:*', () => {
    it('allows schedule when timers:schedule is declared', () => {
      const r = checkPermission('ext', 'asyar:api:timers:schedule', ['timers:schedule'])
      expect(r.allowed).toBe(true)
    })
    it('denies schedule when no permissions are declared', () => {
      const r = checkPermission('ext', 'asyar:api:timers:schedule', [])
      expect(r.allowed).toBe(false)
      expect(r.requiredPermission).toBe('timers:schedule')
    })
    it('allows cancel when timers:cancel is declared', () => {
      const r = checkPermission('ext', 'asyar:api:timers:cancel', ['timers:cancel'])
      expect(r.allowed).toBe(true)
    })
    it('denies cancel when only timers:schedule is declared (separate permission)', () => {
      const r = checkPermission('ext', 'asyar:api:timers:cancel', ['timers:schedule'])
      expect(r.allowed).toBe(false)
      expect(r.requiredPermission).toBe('timers:cancel')
    })
    it('allows list when timers:list is declared', () => {
      const r = checkPermission('ext', 'asyar:api:timers:list', ['timers:list'])
      expect(r.allowed).toBe(true)
    })
    it('denies list when no permissions are declared', () => {
      const r = checkPermission('ext', 'asyar:api:timers:list', [])
      expect(r.allowed).toBe(false)
      expect(r.requiredPermission).toBe('timers:list')
    })
  })

  describe('PERMISSION_MAP', () => {
    it('has entries for all clipboard:read operations', () => {
      expect(PERMISSION_MAP['asyar:api:clipboard:readCurrentClipboard']).toBe('clipboard:read')
      expect(PERMISSION_MAP['asyar:api:clipboard:getRecentItems']).toBe('clipboard:read')
    })

    it('has entries for all clipboard:write operations', () => {
      expect(PERMISSION_MAP['asyar:api:clipboard:writeToClipboard']).toBe('clipboard:write')
      expect(PERMISSION_MAP['asyar:api:clipboard:pasteItem']).toBe('clipboard:write')
    })

    it('maps opener:open to shell:open-url', () => {
      expect(PERMISSION_MAP['asyar:api:opener:open']).toBe('shell:open-url')
    })

    it('maps every timers:* wire-type to its own distinct manifest permission', () => {
      expect(PERMISSION_MAP['asyar:api:timers:schedule']).toBe('timers:schedule')
      expect(PERMISSION_MAP['asyar:api:timers:cancel']).toBe('timers:cancel')
      expect(PERMISSION_MAP['asyar:api:timers:list']).toBe('timers:list')
    })

    it('maps fsWatcher:create and fsWatcher:dispose to fs:watch', () => {
      expect(PERMISSION_MAP['asyar:api:fsWatcher:create']).toBe('fs:watch')
      expect(PERMISSION_MAP['asyar:api:fsWatcher:dispose']).toBe('fs:watch')
    })
  })

  describe('fs:watch', () => {
    it('allows create when fs:watch is declared', () => {
      const r = checkPermission('ext', 'asyar:api:fsWatcher:create', ['fs:watch'])
      expect(r.allowed).toBe(true)
    })
    it('denies create when no permissions are declared', () => {
      const r = checkPermission('ext', 'asyar:api:fsWatcher:create', [])
      expect(r.allowed).toBe(false)
      expect(r.requiredPermission).toBe('fs:watch')
    })
    it('allows dispose when fs:watch is declared', () => {
      const r = checkPermission('ext', 'asyar:api:fsWatcher:dispose', ['fs:watch'])
      expect(r.allowed).toBe(true)
    })
  })
})
