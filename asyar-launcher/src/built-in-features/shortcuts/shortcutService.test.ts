import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetValidShortcutKeys = vi.hoisted(() => vi.fn().mockResolvedValue(['A', 'B', 'Space']))
const mockRegisterItemShortcut = vi.hoisted(() => vi.fn().mockResolvedValue(true))
const mockUnregisterItemShortcut = vi.hoisted(() => vi.fn().mockResolvedValue(true))
const mockStoreGetAll = vi.hoisted(() => vi.fn().mockReturnValue([]))
const mockStoreGetByObjectId = vi.hoisted(() => vi.fn().mockReturnValue(undefined))
const mockStoreAdd = vi.hoisted(() => vi.fn())
const mockStoreRemove = vi.hoisted(() => vi.fn())
const mockAppOpen = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const mockExecuteCommand = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const mockHandleCommandAction = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const mockGetSettings = vi.hoisted(() => vi.fn().mockReturnValue({
  shortcut: { modifier: 'Alt', key: 'Space' },
}))
const mockContextSet = vi.hoisted(() => vi.fn())
const mockContextIsActive = vi.hoisted(() => vi.fn().mockReturnValue(false))
const mockContextDeactivate = vi.hoisted(() => vi.fn())
const mockViewManagerGetStackSize = vi.hoisted(() => vi.fn().mockReturnValue(0))
const mockViewManagerGoBack = vi.hoisted(() => vi.fn())
const mockWithReplacementSemantics = vi.hoisted(() =>
  vi.fn().mockImplementation(async (fn: () => Promise<unknown>) => fn())
)
const mockShowWindow = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const mockSearchStores = vi.hoisted(() => ({ query: '' }))

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

vi.mock('../../services/extension/extensionManager.svelte', () => ({
  __esModule: true,
  default: { handleCommandAction: mockHandleCommandAction },
}))

vi.mock('../../services/settings/settingsService.svelte', () => ({
  settingsService: { getSettings: mockGetSettings },
}))

vi.mock('../../services/context/contextModeService.svelte', () => ({
  contextActivationId: { set: mockContextSet },
  contextModeService: {
    isActive: mockContextIsActive,
    deactivate: mockContextDeactivate,
  },
}))

vi.mock('../../services/extension/viewManager.svelte', () => ({
  viewManager: {
    getNavigationStackSize: mockViewManagerGetStackSize,
    goBack: mockViewManagerGoBack,
    withReplacementSemantics: mockWithReplacementSemantics,
  },
}))

vi.mock('../../services/search/stores/search.svelte', () => ({
  searchStores: mockSearchStores,
}))

vi.mock('../../services/log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('../../lib/ipc/commands', () => ({
  showWindow: mockShowWindow,
  getValidShortcutKeys: mockGetValidShortcutKeys,
  registerItemShortcut: mockRegisterItemShortcut,
  unregisterItemShortcut: mockUnregisterItemShortcut,
}))

import { shortcutService } from './shortcutService'
import { VALID_KEYS } from './shortcutFormatter'

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
  VALID_KEYS.clear()
  mockStoreGetAll.mockReturnValue([])
  mockStoreGetByObjectId.mockReturnValue(undefined)
  mockGetSettings.mockReturnValue({ shortcut: { modifier: 'Alt', key: 'Space' } })
  mockContextIsActive.mockReturnValue(false)
  mockViewManagerGetStackSize.mockReturnValue(0)
  mockSearchStores.query = ''
  mockGetValidShortcutKeys.mockResolvedValue(['A', 'B', 'Space'])
  mockRegisterItemShortcut.mockResolvedValue(true)
  mockUnregisterItemShortcut.mockResolvedValue(true)
})

// ── init ──────────────────────────────────────────────────────────────────────

describe('init', () => {
  it('does nothing when the store is empty', async () => {
    await shortcutService.init()
    expect(mockGetValidShortcutKeys).toHaveBeenCalledTimes(1)
    expect(mockRegisterItemShortcut).not.toHaveBeenCalled()
  })

  it('re-registers each shortcut from the store', async () => {
    mockStoreGetAll.mockReturnValue([
      makeShortcut({ shortcut: 'Alt+A', objectId: 'a' }),
      makeShortcut({ shortcut: 'Control+B', objectId: 'b' }),
    ])
    await shortcutService.init()
    expect(mockGetValidShortcutKeys).toHaveBeenCalledTimes(1)
    expect(mockRegisterItemShortcut).toHaveBeenCalledWith('a', 'Alt', 'A')
    expect(mockRegisterItemShortcut).toHaveBeenCalledWith('b', 'Control', 'B')
  })

  it('continues even when a registration fails', async () => {
    mockStoreGetAll.mockReturnValue([
      makeShortcut({ shortcut: 'Alt+A', objectId: 'a' }),
      makeShortcut({ shortcut: 'Alt+B', objectId: 'b' }),
    ])
    mockRegisterItemShortcut.mockResolvedValueOnce(false) // Alt+A fails
    await expect(shortcutService.init()).resolves.not.toThrow()
    expect(mockRegisterItemShortcut).toHaveBeenCalledTimes(2)
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
    expect(mockRegisterItemShortcut).not.toHaveBeenCalled()
  })

  it('unregisters existing shortcut for same item before registering a new one', async () => {
    const existing = makeShortcut({ shortcut: 'Alt+X', objectId: 'obj-1' })
    mockStoreGetByObjectId.mockReturnValue(existing)
    await shortcutService.register('obj-1', 'App', 'application', 'Alt+Y')
    expect(mockUnregisterItemShortcut).toHaveBeenCalledWith('Alt', 'X')
    expect(mockRegisterItemShortcut).toHaveBeenCalledWith('obj-1', 'Alt', 'Y')
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
    mockRegisterItemShortcut.mockResolvedValueOnce(false)
    const result = await shortcutService.register('obj-1', 'App', 'application', 'Alt+A')
    expect(result.ok).toBe(false)
    expect(mockStoreAdd).not.toHaveBeenCalled()
  })
})

// ── unregister ────────────────────────────────────────────────────────────────

describe('unregister', () => {
  it('does nothing when no shortcut exists for the objectId', async () => {
    await shortcutService.unregister('nonexistent')
    expect(mockUnregisterItemShortcut).not.toHaveBeenCalled()
  })

  it('invokes unregister_item_shortcut with the parsed modifier and key', async () => {
    mockStoreGetByObjectId.mockReturnValue(makeShortcut({ shortcut: 'Control+J', objectId: 'obj-1' }))
    await shortcutService.unregister('obj-1')
    expect(mockUnregisterItemShortcut).toHaveBeenCalledWith('Control', 'J')
  })

  it('removes the item from the store on success', async () => {
    mockStoreGetByObjectId.mockReturnValue(makeShortcut({ objectId: 'obj-1' }))
    await shortcutService.unregister('obj-1')
    expect(mockStoreRemove).toHaveBeenCalledWith('obj-1')
  })

  it('does not remove from store when invoke fails', async () => {
    mockStoreGetByObjectId.mockReturnValue(makeShortcut({ objectId: 'obj-1' }))
    mockUnregisterItemShortcut.mockResolvedValueOnce(false)
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

  it('routes commands through extensionManager.handleCommandAction (not commandService.executeCommand)', async () => {
    // Dynamic commands (cmd_agents_dyn_*, cmd_scripts_dyn_*, cmd_apple_shortcuts_*,
    // etc.) live only in the Rust registry — the TS commandService.commands map
    // never sees them. Hotkeys must dispatch through the same handleCommandAction
    // path the launcher's Enter key uses, so dynamic commands resolve correctly.
    mockStoreGetByObjectId.mockReturnValue(
      makeShortcut({ objectId: 'cmd_agents_dyn_abc', itemType: 'command' })
    )
    await shortcutService.handleFiredShortcut('cmd_agents_dyn_abc')
    expect(mockHandleCommandAction).toHaveBeenCalledWith('cmd_agents_dyn_abc')
    expect(mockExecuteCommand).not.toHaveBeenCalled()
  })

  it('shows the launcher window for view-opening commands', async () => {
    mockHandleCommandAction.mockResolvedValueOnce({ type: 'view', viewPath: 'foo/Bar' })
    mockStoreGetByObjectId.mockReturnValue(
      makeShortcut({ objectId: 'cmd_calc', itemType: 'command' })
    )
    await shortcutService.handleFiredShortcut('cmd_calc')
    expect(mockShowWindow).toHaveBeenCalled()
  })

  it('does NOT show the launcher window when the command returns type:"no-view"', async () => {
    // Silent agents, hotkey-bound scripts, and any other headless dispatcher
    // already hide the window inside handleCommandAction. Re-showing here
    // would pop the launcher into view after a silent in-place text replace —
    // defeating the entire feature.
    mockHandleCommandAction.mockResolvedValueOnce({ type: 'no-view' })
    mockStoreGetByObjectId.mockReturnValue(
      makeShortcut({ objectId: 'cmd_agents_dyn_silent', itemType: 'command' })
    )
    await shortcutService.handleFiredShortcut('cmd_agents_dyn_silent')
    expect(mockHandleCommandAction).toHaveBeenCalledWith('cmd_agents_dyn_silent')
    expect(mockShowWindow).not.toHaveBeenCalled()
  })

  it('runs handleCommandAction inside withReplacementSemantics', async () => {
    mockStoreGetByObjectId.mockReturnValue(
      makeShortcut({ objectId: 'cmd_calc', itemType: 'command' })
    )
    await shortcutService.handleFiredShortcut('cmd_calc')
    expect(mockWithReplacementSemantics).toHaveBeenCalledTimes(1)
    const execOrder = mockHandleCommandAction.mock.invocationCallOrder[0]
    const wrapOrder = mockWithReplacementSemantics.mock.invocationCallOrder[0]
    expect(wrapOrder).toBeLessThan(execOrder)
  })

  it('does not pre-clear the navigation stack for non-portal commands', async () => {
    // Replacement inside withReplacementSemantics handles the swap;
    // calling goBack up front reintroduces the activeView=null frame.
    mockViewManagerGetStackSize.mockReturnValue(2)
    mockStoreGetByObjectId.mockReturnValue(
      makeShortcut({ objectId: 'cmd_calc', itemType: 'command' })
    )
    await shortcutService.handleFiredShortcut('cmd_calc')
    expect(mockViewManagerGoBack).not.toHaveBeenCalled()
  })

  it('clears context and search query before running the command', async () => {
    mockContextIsActive.mockReturnValue(true)
    mockSearchStores.query = 'lingering-typed-query'
    mockStoreGetByObjectId.mockReturnValue(
      makeShortcut({ objectId: 'cmd_calc', itemType: 'command' })
    )
    await shortcutService.handleFiredShortcut('cmd_calc')
    expect(mockContextDeactivate).toHaveBeenCalled()
    expect(mockSearchStores.query).toBe('')
  })

  it('activates portal mode instead of executing for portal commands', async () => {
    mockStoreGetByObjectId.mockReturnValue(
      makeShortcut({ objectId: 'cmd_portals_google', itemType: 'command' })
    )
    await shortcutService.handleFiredShortcut('cmd_portals_google')
    expect(mockShowWindow).toHaveBeenCalled()
    expect(mockContextSet).toHaveBeenCalledWith('google')
    expect(mockExecuteCommand).not.toHaveBeenCalled()
  })

  it('pre-clears the navigation stack for portal commands', async () => {
    mockViewManagerGetStackSize.mockReturnValueOnce(2).mockReturnValueOnce(1).mockReturnValueOnce(0)
    mockStoreGetByObjectId.mockReturnValue(
      makeShortcut({ objectId: 'cmd_portals_google', itemType: 'command' })
    )
    await shortcutService.handleFiredShortcut('cmd_portals_google')
    expect(mockViewManagerGoBack).toHaveBeenCalledTimes(2)
    expect(mockWithReplacementSemantics).not.toHaveBeenCalled()
  })

})
