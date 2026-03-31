import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockInvoke = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const mockStoreGetAll = vi.hoisted(() => vi.fn().mockReturnValue([]))
const mockStoreGetByObjectId = vi.hoisted(() => vi.fn().mockReturnValue(undefined))
const mockStoreAdd = vi.hoisted(() => vi.fn())
const mockStoreRemove = vi.hoisted(() => vi.fn())
const mockAppOpen = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const mockExecuteCommand = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const mockGetSettings = vi.hoisted(() => vi.fn().mockReturnValue({
  shortcut: { modifier: 'Alt', key: 'Space' },
}))
const mockContextSet = vi.hoisted(() => vi.fn())

vi.mock('@tauri-apps/api/core', () => ({ invoke: mockInvoke }))

vi.mock('./shortcutStore.svelte', () => ({
  shortcutStore: {
    getAll: mockStoreGetAll,
    getByObjectId: mockStoreGetByObjectId,
    add: mockStoreAdd,
    remove: mockStoreRemove,
    get shortcuts() { return mockStoreGetAll() },
  },
}))

vi.mock('../../services/application/applicationsService', () => ({
  applicationService: { open: mockAppOpen },
}))

vi.mock('../../services/extension/commandService.svelte', () => ({
  commandService: { executeCommand: mockExecuteCommand },
}))

vi.mock('../../services/settings/settingsService.svelte', () => ({
  settingsService: { getSettings: mockGetSettings },
}))

vi.mock('../../services/context/contextModeService.svelte', () => ({
  contextActivationId: { set: mockContextSet },
}))

vi.mock('../../services/log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { shortcutService } from './shortcutService'

function makeShortcut(overrides: object = {}) {
  return {
    id: 'id-1',
    objectId: 'obj-1',
    itemName: 'Test App',
    itemType: 'application' as const,
    shortcut: 'Alt+A',
    createdAt: 0,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockStoreGetAll.mockReturnValue([])
  mockStoreGetByObjectId.mockReturnValue(undefined)
  mockGetSettings.mockReturnValue({ shortcut: { modifier: 'Alt', key: 'Space' } })
})

// ── init ──────────────────────────────────────────────────────────────────────

describe('init', () => {
  it('does nothing when the store is empty', async () => {
    await shortcutService.init()
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it('re-registers each shortcut from the store', async () => {
    mockStoreGetAll.mockReturnValue([
      makeShortcut({ shortcut: 'Alt+A', objectId: 'a' }),
      makeShortcut({ shortcut: 'Control+B', objectId: 'b' }),
    ])
    await shortcutService.init()
    expect(mockInvoke).toHaveBeenCalledWith('register_item_shortcut', { modifier: 'Alt', key: 'A', objectId: 'a' })
    expect(mockInvoke).toHaveBeenCalledWith('register_item_shortcut', { modifier: 'Control', key: 'B', objectId: 'b' })
  })

  it('continues even when a registration fails', async () => {
    mockStoreGetAll.mockReturnValue([
      makeShortcut({ shortcut: 'Alt+A', objectId: 'a' }),
      makeShortcut({ shortcut: 'Alt+B', objectId: 'b' }),
    ])
    mockInvoke.mockRejectedValueOnce(new Error('conflict'))
    await expect(shortcutService.init()).resolves.not.toThrow()
    expect(mockInvoke).toHaveBeenCalledTimes(2)
  })
})

// ── isConflict ────────────────────────────────────────────────────────────────

describe('isConflict', () => {
  it('returns null when no conflict exists', async () => {
    expect(await shortcutService.isConflict('Alt+Z')).toBeNull()
  })

  it('returns the conflicting item when the shortcut is already taken', async () => {
    mockStoreGetAll.mockReturnValue([makeShortcut({ shortcut: 'Alt+A', objectId: 'obj-1', itemName: 'App' })])
    const result = await shortcutService.isConflict('Alt+A')
    expect(result).toEqual({ objectId: 'obj-1', itemName: 'App' })
  })

  it('excludes the item with the given objectId from conflict checking', async () => {
    mockStoreGetAll.mockReturnValue([makeShortcut({ shortcut: 'Alt+A', objectId: 'obj-1' })])
    expect(await shortcutService.isConflict('Alt+A', 'obj-1')).toBeNull()
  })

  it('returns a conflict when the shortcut matches the launcher shortcut', async () => {
    const result = await shortcutService.isConflict('Alt+Space')
    expect(result).toEqual({ objectId: 'launcher', itemName: 'Launcher Toggle' })
  })

  it('returns null when launcher shortcut check throws', async () => {
    mockGetSettings.mockImplementationOnce(() => { throw new Error('not ready') })
    expect(await shortcutService.isConflict('Alt+Space')).toBeNull()
  })
})

// ── getShortcutForItem / getAllShortcuts ───────────────────────────────────────

describe('getShortcutForItem', () => {
  it('delegates to shortcutStore.getByObjectId', () => {
    const s = makeShortcut()
    mockStoreGetByObjectId.mockReturnValue(s)
    expect(shortcutService.getShortcutForItem('obj-1')).toBe(s)
    expect(mockStoreGetByObjectId).toHaveBeenCalledWith('obj-1')
  })

  it('returns undefined when the item has no shortcut', () => {
    expect(shortcutService.getShortcutForItem('unknown')).toBeUndefined()
  })
})

describe('getAllShortcuts', () => {
  it('delegates to shortcutStore.getAll', () => {
    const list = [makeShortcut()]
    mockStoreGetAll.mockReturnValue(list)
    expect(shortcutService.getAllShortcuts()).toBe(list)
  })
})

// ── register ──────────────────────────────────────────────────────────────────

describe('register', () => {
  it('returns a conflict when the shortcut is already taken by another item', async () => {
    mockStoreGetAll.mockReturnValue([makeShortcut({ shortcut: 'Alt+A', objectId: 'other', itemName: 'Other' })])
    const result = await shortcutService.register('obj-new', 'New App', 'application', 'Alt+A')
    expect(result).toEqual({ ok: false, conflict: { objectId: 'other', itemName: 'Other' } })
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it('unregisters existing shortcut for same item before registering a new one', async () => {
    const existing = makeShortcut({ shortcut: 'Alt+X', objectId: 'obj-1' })
    mockStoreGetByObjectId.mockReturnValue(existing)
    await shortcutService.register('obj-1', 'App', 'application', 'Alt+Y')
    expect(mockInvoke).toHaveBeenCalledWith('unregister_item_shortcut', { modifier: 'Alt', key: 'X' })
    expect(mockInvoke).toHaveBeenCalledWith('register_item_shortcut', { modifier: 'Alt', key: 'Y', objectId: 'obj-1' })
  })

  it('adds the shortcut to the store and returns { ok: true } on success', async () => {
    const result = await shortcutService.register('obj-1', 'App', 'application', 'Alt+A', '/path/App.app')
    expect(result).toEqual({ ok: true })
    expect(mockStoreAdd).toHaveBeenCalledWith(expect.objectContaining({
      objectId: 'obj-1',
      itemName: 'App',
      itemType: 'application',
      shortcut: 'Alt+A',
      itemPath: '/path/App.app',
    }))
  })

  it('returns { ok: false } when invoke throws', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('already registered'))
    const result = await shortcutService.register('obj-1', 'App', 'application', 'Alt+A')
    expect(result.ok).toBe(false)
    expect(mockStoreAdd).not.toHaveBeenCalled()
  })
})

// ── unregister ────────────────────────────────────────────────────────────────

describe('unregister', () => {
  it('does nothing when no shortcut exists for the objectId', async () => {
    await shortcutService.unregister('nonexistent')
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it('invokes unregister_item_shortcut with the parsed modifier and key', async () => {
    mockStoreGetByObjectId.mockReturnValue(makeShortcut({ shortcut: 'Control+J', objectId: 'obj-1' }))
    await shortcutService.unregister('obj-1')
    expect(mockInvoke).toHaveBeenCalledWith('unregister_item_shortcut', { modifier: 'Control', key: 'J' })
  })

  it('removes the item from the store on success', async () => {
    mockStoreGetByObjectId.mockReturnValue(makeShortcut({ objectId: 'obj-1' }))
    await shortcutService.unregister('obj-1')
    expect(mockStoreRemove).toHaveBeenCalledWith('obj-1')
  })

  it('does not remove from store when invoke fails', async () => {
    mockStoreGetByObjectId.mockReturnValue(makeShortcut({ objectId: 'obj-1' }))
    mockInvoke.mockRejectedValueOnce(new Error('not registered'))
    await shortcutService.unregister('obj-1')
    expect(mockStoreRemove).not.toHaveBeenCalled()
  })
})

// ── handleFiredShortcut ───────────────────────────────────────────────────────

describe('handleFiredShortcut', () => {
  it('does nothing when the objectId is not in the store', async () => {
    await shortcutService.handleFiredShortcut('unknown')
    expect(mockAppOpen).not.toHaveBeenCalled()
    expect(mockExecuteCommand).not.toHaveBeenCalled()
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it('opens an application when itemType is "application"', async () => {
    mockStoreGetByObjectId.mockReturnValue(
      makeShortcut({ objectId: 'obj-1', itemName: 'Finder', itemType: 'application', itemPath: '/App/Finder.app' })
    )
    await shortcutService.handleFiredShortcut('obj-1')
    expect(mockAppOpen).toHaveBeenCalledWith(expect.objectContaining({
      objectId: 'obj-1',
      name: 'Finder',
      path: '/App/Finder.app',
    }))
  })

  it('executes a command when itemType is "command"', async () => {
    mockStoreGetByObjectId.mockReturnValue(
      makeShortcut({ objectId: 'cmd_calc', itemType: 'command' })
    )
    await shortcutService.handleFiredShortcut('cmd_calc')
    expect(mockInvoke).toHaveBeenCalledWith('show')
    expect(mockExecuteCommand).toHaveBeenCalledWith('cmd_calc')
  })

  it('activates portal mode instead of executing for portal commands', async () => {
    mockStoreGetByObjectId.mockReturnValue(
      makeShortcut({ objectId: 'cmd_portals_google', itemType: 'command' })
    )
    await shortcutService.handleFiredShortcut('cmd_portals_google')
    expect(mockInvoke).toHaveBeenCalledWith('show')
    expect(mockContextSet).toHaveBeenCalledWith('google')
    expect(mockExecuteCommand).not.toHaveBeenCalled()
  })
})
