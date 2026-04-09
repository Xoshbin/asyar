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
    it('allows notify when notifications:send is declared', () => {
      expect(checkPermission('ext', 'asyar:api:notification:notify', ['notifications:send']).allowed).toBe(true)
    })

    it('allows show when notifications:send is declared', () => {
      expect(checkPermission('ext', 'asyar:api:notification:show', ['notifications:send']).allowed).toBe(true)
    })

    it('denies notify when not declared', () => {
      const result = checkPermission('ext', 'asyar:api:notification:notify', [])
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

  // ── Service-style API calls ────────────────────────────────────────────────

  describe('service-style call types', () => {
    it('maps ClipboardHistoryService:get to clipboard:read', () => {
      const result = checkPermission('ext', 'asyar:service:ClipboardHistoryService:get', [])
      expect(result.allowed).toBe(false)
      expect(result.requiredPermission).toBe('clipboard:read')
    })

    it('maps StoreService:set to store:write', () => {
      const result = checkPermission('ext', 'asyar:service:StoreService:set', [])
      expect(result.allowed).toBe(false)
      expect(result.requiredPermission).toBe('store:write')
    })

    it('maps ShellService:spawn to shell:spawn', () => {
      const result = checkPermission('ext', 'asyar:service:ShellService:spawn', [])
      expect(result.allowed).toBe(false)
      expect(result.requiredPermission).toBe('shell:spawn')
    })
  })

  // ── PERMISSION_MAP structure ───────────────────────────────────────────────

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
  })
})
