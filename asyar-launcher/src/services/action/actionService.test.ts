import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ActionService, type ApplicationAction } from './actionService.svelte'
import { ActionContext } from 'asyar-sdk'

vi.mock('../log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

vi.mock('../search/SearchService', () => ({
  searchService: { resetIndex: vi.fn() },
}))

vi.mock('tauri-plugin-clipboard-x-api', () => ({
  writeText: vi.fn().mockResolvedValue(undefined),
}))

const mockSearchOrchestrator = vi.hoisted(() => ({ items: [] as any[] }))
vi.mock('../search/searchOrchestrator.svelte', () => ({
  searchOrchestrator: mockSearchOrchestrator,
}))

const mockSearchStores = vi.hoisted(() => ({ selectedIndex: -1 }))
vi.mock('../search/stores/search.svelte', () => ({
  searchStores: mockSearchStores,
}))

const mockFeedbackService = vi.hoisted(() => ({
  showHUD: vi.fn().mockResolvedValue(undefined),
  confirmAlert: vi.fn().mockResolvedValue(true),
}))
vi.mock('../feedback/feedbackService.svelte', () => ({
  feedbackService: mockFeedbackService,
}))

const mockApplicationService = vi.hoisted(() => ({
  uninstallApplication: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../application/applicationService', () => ({
  applicationService: mockApplicationService,
}))

// Platform detection is module-level in actionService — mocking here controls
// the IS_MACOS constant for every test in this file. Individual tests that
// need a non-macOS platform would need to be in a separate file with a
// different mock.
vi.mock('@tauri-apps/plugin-os', () => ({
  platform: () => 'macos',
}))

// Fresh instance per test so tests are isolated
function freshService(): ActionService {
  return new ActionService()
}

// Minimal action factory
function makeAction(
  id: string,
  context: ActionContext = ActionContext.EXTENSION_VIEW,
  extensionId?: string
): ApplicationAction {
  return {
    id,
    label: id,
    context,
    extensionId,
    execute: vi.fn(),
  }
}

// ── registerAction ────────────────────────────────────────────────────────────

describe('registerAction', () => {
  it('stores the action and makes it retrievable via getAllActions', () => {
    const svc = freshService()
    svc.registerAction(makeAction('my-action'))
    const ids = svc.getAllActions().map((a) => a.id)
    expect(ids).toContain('my-action')
  })

  it('overwrites an existing action with the same id', () => {
    const svc = freshService()
    svc.registerAction(makeAction('dup'))
    svc.registerAction({ ...makeAction('dup'), label: 'updated' })
    const matches = svc.getAllActions().filter((a) => a.id === 'dup')
    expect(matches).toHaveLength(1)
    expect(matches[0].label).toBe('updated')
  })

  it('normalises ExtensionAction title → label', () => {
    const svc = freshService()
    svc.registerAction({
      id: 'ext-action',
      title: 'My Title',
      extensionId: 'my-ext',
      execute: vi.fn(),
    } as any)
    const action = svc.getAllActions().find((a) => a.id === 'ext-action')
    expect(action?.label).toBe('My Title')
  })

  it('defaults context to EXTENSION_VIEW when none provided', () => {
    const svc = freshService()
    svc.registerAction({ id: 'no-ctx', title: 'x', extensionId: 'e', execute: vi.fn() } as any)
    const action = svc.getAllActions().find((a) => a.id === 'no-ctx')
    expect(action?.context).toBe(ActionContext.EXTENSION_VIEW)
  })

  it('preserves confirm: true through registerAction normalization', () => {
    const svc = freshService()
    svc.registerAction({ ...makeAction('confirm-me'), confirm: true } as any)
    const action = svc.getAllActions().find(a => a.id === 'confirm-me')
    expect(action?.confirm).toBe(true)
  })

  it('confirm defaults to undefined when not provided', () => {
    const svc = freshService()
    svc.registerAction(makeAction('no-confirm'))
    const action = svc.getAllActions().find(a => a.id === 'no-confirm')
    expect(action?.confirm).toBeUndefined()
  })

  it('preserves shortcut through registerAction normalization', () => {
    const svc = freshService()
    svc.registerAction({ ...makeAction('shortcut-me'), shortcut: '⌘⇧C' } as any)
    const action = svc.getAllActions().find(a => a.id === 'shortcut-me')
    expect(action?.shortcut).toBe('⌘⇧C')
  })

  it('shortcut defaults to undefined when not provided', () => {
    const svc = freshService()
    svc.registerAction(makeAction('no-shortcut'))
    const action = svc.getAllActions().find(a => a.id === 'no-shortcut')
    expect(action?.shortcut).toBeUndefined()
  })
})

// ── unregisterAction ──────────────────────────────────────────────────────────

describe('unregisterAction', () => {
  it('removes a registered action', () => {
    const svc = freshService()
    svc.registerAction(makeAction('to-remove'))
    svc.unregisterAction('to-remove')
    expect(svc.getAllActions().map((a) => a.id)).not.toContain('to-remove')
  })

  it('does not throw when removing a non-existent action', () => {
    const svc = freshService()
    expect(() => svc.unregisterAction('ghost')).not.toThrow()
  })
})

// ── clearActionsForExtension ──────────────────────────────────────────────────

describe('clearActionsForExtension', () => {
  it('removes all actions belonging to the given extension', () => {
    const svc = freshService()
    svc.registerAction(makeAction('a1', ActionContext.EXTENSION_VIEW, 'ext-a'))
    svc.registerAction(makeAction('a2', ActionContext.EXTENSION_VIEW, 'ext-a'))
    svc.registerAction(makeAction('b1', ActionContext.EXTENSION_VIEW, 'ext-b'))
    svc.clearActionsForExtension('ext-a')
    const ids = svc.getAllActions().map((a) => a.id)
    expect(ids).not.toContain('a1')
    expect(ids).not.toContain('a2')
    expect(ids).toContain('b1')
  })

  it('does nothing when the extension has no registered actions', () => {
    const svc = freshService()
    const before = svc.getAllActions().length
    svc.clearActionsForExtension('nonexistent-ext')
    expect(svc.getAllActions().length).toBe(before)
  })
})

// ── setContext / getContext ───────────────────────────────────────────────────

describe('setContext / getContext', () => {
  it('starts in CORE context', () => {
    const svc = freshService()
    expect(svc.getContext()).toBe(ActionContext.CORE)
  })

  it('updates the context', () => {
    const svc = freshService()
    svc.setContext(ActionContext.EXTENSION_VIEW)
    expect(svc.getContext()).toBe(ActionContext.EXTENSION_VIEW)
  })

  it('does not trigger an update when context is unchanged', () => {
    const svc = freshService()
    // Already CORE; set CORE again — should be a no-op
    const before = svc.filteredActions
    svc.setContext(ActionContext.CORE)
    expect(svc.filteredActions).toBe(before)
  })
})

// ── filterActionsByContext ────────────────────────────────────────────────────

describe('filterActionsByContext (via getActions)', () => {
  it('returns actions whose context exactly matches the requested context', () => {
    const svc = freshService()
    svc.registerAction(makeAction('ev', ActionContext.EXTENSION_VIEW))
    svc.registerAction(makeAction('sv', ActionContext.SEARCH_VIEW))
    const ids = svc.getActions(ActionContext.EXTENSION_VIEW).map((a) => a.id)
    expect(ids).toContain('ev')
    expect(ids).not.toContain('sv')
  })

  it('shows GLOBAL actions in filteredActions when context is CORE', () => {
    const svc = freshService()
    svc.registerAction(makeAction('global-b', ActionContext.GLOBAL))
    svc.setContext(ActionContext.CORE)
    const ids = svc.filteredActions.map((a) => a.id)
    expect(ids).toContain('global-b')
  })

  it('shows GLOBAL actions in filteredActions when context is EXTENSION_VIEW', () => {
    const svc = freshService()
    svc.registerAction(makeAction('global-c', ActionContext.GLOBAL))
    svc.setContext(ActionContext.EXTENSION_VIEW)
    const ids = svc.filteredActions.map((a) => a.id)
    expect(ids).toContain('global-c')
  })

  it('does NOT show GLOBAL actions in SEARCH_VIEW context', () => {
    const svc = freshService()
    svc.registerAction(makeAction('global-d', ActionContext.GLOBAL))
    svc.setContext(ActionContext.SEARCH_VIEW)
    const ids = svc.filteredActions.map((a) => a.id)
    expect(ids).not.toContain('global-d')
  })

  it('shows CORE actions in CORE context when no other specific actions exist', () => {
    const svc = freshService()
    svc.registerAction(makeAction('core-a', ActionContext.CORE))
    svc.setContext(ActionContext.CORE)
    const ids = svc.filteredActions.map((a) => a.id)
    expect(ids).toContain('core-a')
  })
})

// ── visible callback ─────────────────────────────────────────────────────────

describe('visible callback', () => {
  it('excludes action from filteredActions when visible returns false', () => {
    const svc = freshService()
    svc.setContext(ActionContext.CORE)
    svc.registerAction({ ...makeAction('hidden', ActionContext.CORE), visible: () => false })
    expect(svc.filteredActions.map(a => a.id)).not.toContain('hidden')
  })

  it('includes action in filteredActions when visible returns true', () => {
    const svc = freshService()
    svc.setContext(ActionContext.CORE)
    svc.registerAction({ ...makeAction('shown', ActionContext.CORE), visible: () => true })
    expect(svc.filteredActions.map(a => a.id)).toContain('shown')
  })

  it('includes action when visible is not set (backward compat)', () => {
    const svc = freshService()
    svc.setContext(ActionContext.CORE)
    svc.registerAction(makeAction('no-visible', ActionContext.CORE))
    expect(svc.filteredActions.map(a => a.id)).toContain('no-visible')
  })

  it('re-evaluates visible when updateState runs via registerAction', () => {
    const svc = freshService()
    svc.setContext(ActionContext.CORE)
    let show = false
    svc.registerAction({ ...makeAction('toggle', ActionContext.CORE), visible: () => show })
    expect(svc.filteredActions.map(a => a.id)).not.toContain('toggle')

    // Flip the flag and trigger updateState by re-registering a dummy action
    show = true
    svc.registerAction(makeAction('dummy', ActionContext.CORE))
    expect(svc.filteredActions.map(a => a.id)).toContain('toggle')
  })
})

// ── executeAction ─────────────────────────────────────────────────────────────

describe('executeAction', () => {
  it('calls the action execute function', async () => {
    const svc = freshService()
    const execute = vi.fn()
    svc.registerAction({ ...makeAction('run-me'), execute })
    await svc.executeAction('run-me')
    expect(execute).toHaveBeenCalledOnce()
  })

  it('throws when the action does not exist', async () => {
    const svc = freshService()
    await expect(svc.executeAction('does-not-exist')).rejects.toThrow('Action not found: does-not-exist')
  })

  it('re-throws errors from the execute function', async () => {
    const svc = freshService()
    svc.registerAction({
      ...makeAction('faulty'),
      execute: () => { throw new Error('boom') },
    })
    await expect(svc.executeAction('faulty')).rejects.toThrow('boom')
  })

  it('forwards to sendToExtension when execute is not a function and extensionId is set', async () => {
    const svc = freshService()
    const forwarder = vi.fn()
    svc.setExtensionForwarder(forwarder)
    // Register with no execute fn but with extensionId
    svc.registerAction({
      id: 'ext-fwd',
      label: 'ext-fwd',
      extensionId: 'my-ext',
      context: ActionContext.EXTENSION_VIEW,
      execute: undefined as any, // simulate missing execute
    })
    await svc.executeAction('ext-fwd')
    expect(forwarder).toHaveBeenCalledWith('my-ext', 'ext-fwd')
  })
})

// ── filteredActions updates ───────────────────────────────────────────────────────

describe('filteredActions', () => {
  it('reflects newly registered actions matching the current context', () => {
    const svc = freshService()
    svc.setContext(ActionContext.EXTENSION_VIEW)
    svc.registerAction(makeAction('store-test', ActionContext.EXTENSION_VIEW))
    expect(svc.filteredActions.map((a) => a.id)).toContain('store-test')
  })

  it('removes an action from the state when it is unregistered', () => {
    const svc = freshService()
    svc.setContext(ActionContext.EXTENSION_VIEW)
    svc.registerAction(makeAction('remove-from-store', ActionContext.EXTENSION_VIEW))
    svc.unregisterAction('remove-from-store')
    expect(svc.filteredActions.map((a) => a.id)).not.toContain('remove-from-store')
  })
})

// ── copy_deeplink built-in action ────────────────────────────────────────────

describe('copy_deeplink built-in action', () => {
  function makeCommandResult(extensionId: string, commandId: string) {
    return {
      objectId: `cmd_${extensionId}_${commandId}`,
      name: commandId,
      type: 'command' as const,
      score: 1,
      extensionId,
    }
  }

  function makeAppResult() {
    return {
      objectId: 'app_finder',
      name: 'Finder',
      type: 'application' as const,
      score: 1,
    }
  }

  beforeEach(() => {
    mockSearchStores.selectedIndex = -1
    mockSearchOrchestrator.items = []
    vi.clearAllMocks()
  })

  it('is registered as a built-in action', () => {
    const svc = freshService()
    const ids = svc.getAllActions().map(a => a.id)
    expect(ids).toContain('copy_deeplink')
  })

  it('has correct metadata', () => {
    const svc = freshService()
    const action = svc.getAllActions().find(a => a.id === 'copy_deeplink')
    expect(action).toBeDefined()
    expect(action!.context).toBe(ActionContext.CORE)
    expect(action!.shortcut).toBe('⌘⇧C')
    expect(action!.category).toBe('Share')
    expect(action!.icon).toBe('icon:link')
  })

  it('visible returns false when no item is selected', () => {
    const svc = freshService()
    mockSearchStores.selectedIndex = -1
    const action = svc.getAllActions().find(a => a.id === 'copy_deeplink')
    expect(action!.visible!()).toBe(false)
  })

  it('visible returns false when selected item is type application', () => {
    const svc = freshService()
    mockSearchOrchestrator.items = [makeAppResult()]
    mockSearchStores.selectedIndex = 0
    const action = svc.getAllActions().find(a => a.id === 'copy_deeplink')
    expect(action!.visible!()).toBe(false)
  })

  it('visible returns true when selected item is type command', () => {
    const svc = freshService()
    mockSearchOrchestrator.items = [makeCommandResult('com.example.ext', 'mycommand')]
    mockSearchStores.selectedIndex = 0
    const action = svc.getAllActions().find(a => a.id === 'copy_deeplink')
    expect(action!.visible!()).toBe(true)
  })

  it('execute copies correct deeplink URL to clipboard', async () => {
    const svc = freshService()
    mockSearchOrchestrator.items = [makeCommandResult('com.example.ext', 'mycommand')]
    mockSearchStores.selectedIndex = 0

    const { writeText } = await import('tauri-plugin-clipboard-x-api')
    await svc.executeAction('copy_deeplink')
    expect(writeText).toHaveBeenCalledWith('asyar://extensions/com.example.ext/mycommand')
  })

  it('execute shows HUD after copying', async () => {
    const svc = freshService()
    mockSearchOrchestrator.items = [makeCommandResult('com.example.ext', 'mycommand')]
    mockSearchStores.selectedIndex = 0

    await svc.executeAction('copy_deeplink')
    expect(mockFeedbackService.showHUD).toHaveBeenCalledWith('Deeplink Copied to Clipboard')
  })

  it('execute is a no-op when no command is selected', async () => {
    const svc = freshService()
    mockSearchStores.selectedIndex = -1

    const { writeText } = await import('tauri-plugin-clipboard-x-api')
    await svc.executeAction('copy_deeplink')
    expect(writeText).not.toHaveBeenCalled()
    expect(mockFeedbackService.showHUD).not.toHaveBeenCalled()
  })

  it('execute correctly parses commandId with hyphens from objectId', async () => {
    const svc = freshService()
    mockSearchOrchestrator.items = [makeCommandResult('com.example.ext', 'open-url')]
    mockSearchStores.selectedIndex = 0

    const { writeText } = await import('tauri-plugin-clipboard-x-api')
    await svc.executeAction('copy_deeplink')
    expect(writeText).toHaveBeenCalledWith('asyar://extensions/com.example.ext/open-url')
  })
})

// ── manifest-declared extension actions ──────────────────────────────────────

describe('manifest-declared extension actions', () => {
  function makeCommandItem(extensionId: string, commandId: string) {
    return {
      objectId: `cmd_${extensionId}_${commandId}`,
      name: commandId,
      type: 'command' as const,
      score: 1,
      extensionId,
    }
  }

  beforeEach(() => {
    mockSearchStores.selectedIndex = -1
    mockSearchOrchestrator.items = []
    vi.clearAllMocks()
  })

  it('extension-level action visible when its extension command is selected', () => {
    const svc = freshService()
    svc.registerAction({
      id: 'act_com.example.github_open-browser',
      label: 'Open in Browser',
      extensionId: 'com.example.github',
      context: ActionContext.CORE,
      visible: () => {
        const idx = mockSearchStores.selectedIndex
        if (idx < 0) return false
        const item = mockSearchOrchestrator.items[idx]
        return item?.type === 'command' && item.extensionId === 'com.example.github'
      },
      execute: undefined as any, // no callback — relies on forwarder
    })

    mockSearchOrchestrator.items = [makeCommandItem('com.example.github', 'search-repos')]
    mockSearchStores.selectedIndex = 0
    svc.refreshFiltered()

    expect(svc.filteredActions.map(a => a.id)).toContain('act_com.example.github_open-browser')
  })

  it('extension-level action hidden when different extension is selected', () => {
    const svc = freshService()
    svc.registerAction({
      id: 'act_com.example.github_open-browser',
      label: 'Open in Browser',
      extensionId: 'com.example.github',
      context: ActionContext.CORE,
      visible: () => {
        const idx = mockSearchStores.selectedIndex
        if (idx < 0) return false
        const item = mockSearchOrchestrator.items[idx]
        return item?.type === 'command' && item.extensionId === 'com.example.github'
      },
      execute: undefined as any,
    })

    mockSearchOrchestrator.items = [makeCommandItem('com.other.ext', 'some-cmd')]
    mockSearchStores.selectedIndex = 0
    svc.refreshFiltered()

    expect(svc.filteredActions.map(a => a.id)).not.toContain('act_com.example.github_open-browser')
  })

  it('command-level action visible only when specific command is selected', () => {
    const svc = freshService()
    svc.registerAction({
      id: 'act_com.example.github_clone-repo',
      label: 'Clone Repository',
      extensionId: 'com.example.github',
      context: ActionContext.CORE,
      visible: () => {
        const idx = mockSearchStores.selectedIndex
        if (idx < 0) return false
        const item = mockSearchOrchestrator.items[idx]
        return item?.objectId === 'cmd_com.example.github_search-repos'
      },
      execute: undefined as any,
    })

    // Select the right command
    mockSearchOrchestrator.items = [makeCommandItem('com.example.github', 'search-repos')]
    mockSearchStores.selectedIndex = 0
    svc.refreshFiltered()
    expect(svc.filteredActions.map(a => a.id)).toContain('act_com.example.github_clone-repo')

    // Select a different command from the same extension
    mockSearchOrchestrator.items = [makeCommandItem('com.example.github', 'search-issues')]
    svc.refreshFiltered()
    expect(svc.filteredActions.map(a => a.id)).not.toContain('act_com.example.github_clone-repo')
  })

  it('action without execute triggers sendToExtension forwarder', async () => {
    const svc = freshService()
    const forwarder = vi.fn()
    svc.setExtensionForwarder(forwarder)

    svc.registerAction({
      id: 'act_com.example.github_open-browser',
      label: 'Open in Browser',
      extensionId: 'com.example.github',
      context: ActionContext.CORE,
      execute: undefined as any,
    })

    await svc.executeAction('act_com.example.github_open-browser')
    expect(forwarder).toHaveBeenCalledWith('com.example.github', 'act_com.example.github_open-browser')
  })

  it('refreshFiltered re-evaluates visible callbacks', () => {
    const svc = freshService()
    svc.registerAction({
      id: 'act_com.example.github_open-browser',
      label: 'Open in Browser',
      extensionId: 'com.example.github',
      context: ActionContext.CORE,
      visible: () => {
        const idx = mockSearchStores.selectedIndex
        if (idx < 0) return false
        const item = mockSearchOrchestrator.items[idx]
        return item?.type === 'command' && item.extensionId === 'com.example.github'
      },
      execute: undefined as any,
    })

    // Initially no selection
    svc.refreshFiltered()
    expect(svc.filteredActions.map(a => a.id)).not.toContain('act_com.example.github_open-browser')

    // Select a matching item and refresh
    mockSearchOrchestrator.items = [makeCommandItem('com.example.github', 'search')]
    mockSearchStores.selectedIndex = 0
    svc.refreshFiltered()
    expect(svc.filteredActions.map(a => a.id)).toContain('act_com.example.github_open-browser')
  })
})

// ── setActionExecutor ─────────────────────────────────────────────────────────

describe('setActionExecutor', () => {
  it('sets the execute function on an existing action', async () => {
    const svc = freshService()
    svc.registerAction({ ...makeAction('act_my-ext_do-thing', ActionContext.CORE), execute: undefined as any })
    const executor = vi.fn()
    svc.setActionExecutor('act_my-ext_do-thing', executor)
    await svc.executeAction('act_my-ext_do-thing')
    expect(executor).toHaveBeenCalledOnce()
  })

  it('preserves the visible callback after setting executor', () => {
    const svc = freshService()
    const visible = vi.fn().mockReturnValue(false)
    svc.registerAction({ ...makeAction('act_my-ext_do-thing', ActionContext.CORE), visible, execute: undefined as any })
    svc.setActionExecutor('act_my-ext_do-thing', vi.fn())
    const action = svc.getAllActions().find(a => a.id === 'act_my-ext_do-thing')
    expect(action?.visible).toBe(visible)
  })

  it('preserves label, extensionId, and context after setting executor', () => {
    const svc = freshService()
    svc.registerAction({
      id: 'act_my-ext_do-thing',
      label: 'Do Thing',
      extensionId: 'my-ext',
      context: ActionContext.CORE,
      execute: undefined as any,
    })
    svc.setActionExecutor('act_my-ext_do-thing', vi.fn())
    const action = svc.getAllActions().find(a => a.id === 'act_my-ext_do-thing')
    expect(action?.label).toBe('Do Thing')
    expect(action?.extensionId).toBe('my-ext')
    expect(action?.context).toBe(ActionContext.CORE)
  })

  it('is a no-op when the action does not exist', () => {
    const svc = freshService()
    expect(() => svc.setActionExecutor('nonexistent', vi.fn())).not.toThrow()
  })
})

// ── uninstall_application built-in action ────────────────────────────────────

describe('uninstall_application built-in action', () => {
  function makeAppResult(overrides: Partial<{ path: string; name: string; objectId: string }> = {}) {
    return {
      objectId: overrides.objectId ?? 'app_Foo_Applications_Foo_app',
      name: overrides.name ?? 'Foo',
      type: 'application' as const,
      score: 1,
      path: overrides.path ?? '/Applications/Foo.app',
    }
  }

  function makeCommandResult() {
    return {
      objectId: 'cmd_com.example_hello',
      name: 'hello',
      type: 'command' as const,
      score: 1,
      extensionId: 'com.example',
    }
  }

  beforeEach(() => {
    mockSearchStores.selectedIndex = -1
    mockSearchOrchestrator.items = []
    mockApplicationService.uninstallApplication.mockReset().mockResolvedValue(undefined)
    mockFeedbackService.showHUD.mockReset().mockResolvedValue(undefined)
    mockFeedbackService.confirmAlert.mockReset().mockResolvedValue(true)
  })

  it('is registered as a built-in action', () => {
    const svc = freshService()
    const ids = svc.getAllActions().map(a => a.id)
    expect(ids).toContain('uninstall_application')
  })

  it('has correct metadata (icon, shortcut, category, confirm flag)', () => {
    const svc = freshService()
    const action = svc.getAllActions().find(a => a.id === 'uninstall_application')
    expect(action).toBeDefined()
    expect(action!.icon).toBe('icon:trash')
    expect(action!.shortcut).toBe('⌘⌫')
    expect(action!.category).toBe('Danger')
    expect(action!.confirm).toBe(true)
    expect(action!.context).toBe(ActionContext.CORE)
  })

  it('visible returns false when no item is selected', () => {
    const svc = freshService()
    mockSearchStores.selectedIndex = -1
    const action = svc.getAllActions().find(a => a.id === 'uninstall_application')
    expect(action!.visible!()).toBe(false)
  })

  it('visible returns false when selected item is a command (type !== application)', () => {
    const svc = freshService()
    mockSearchOrchestrator.items = [makeCommandResult()]
    mockSearchStores.selectedIndex = 0
    const action = svc.getAllActions().find(a => a.id === 'uninstall_application')
    expect(action!.visible!()).toBe(false)
  })

  it('visible returns false when selected application has no path', () => {
    const svc = freshService()
    mockSearchOrchestrator.items = [{ ...makeAppResult(), path: undefined } as any]
    mockSearchStores.selectedIndex = 0
    const action = svc.getAllActions().find(a => a.id === 'uninstall_application')
    expect(action!.visible!()).toBe(false)
  })

  it('visible returns false for /System/ paths', () => {
    const svc = freshService()
    mockSearchOrchestrator.items = [
      makeAppResult({ path: '/System/Applications/Calendar.app', name: 'Calendar' }),
    ]
    mockSearchStores.selectedIndex = 0
    const action = svc.getAllActions().find(a => a.id === 'uninstall_application')
    expect(action!.visible!()).toBe(false)
  })

  it('visible returns true for a normal user-installed application', () => {
    const svc = freshService()
    mockSearchOrchestrator.items = [makeAppResult()]
    mockSearchStores.selectedIndex = 0
    const action = svc.getAllActions().find(a => a.id === 'uninstall_application')
    expect(action!.visible!()).toBe(true)
  })

  it('execute shows a confirm dialog before calling Rust', async () => {
    const svc = freshService()
    mockSearchOrchestrator.items = [makeAppResult()]
    mockSearchStores.selectedIndex = 0

    await svc.executeAction('uninstall_application')

    expect(mockFeedbackService.confirmAlert).toHaveBeenCalledOnce()
    const opts = mockFeedbackService.confirmAlert.mock.calls[0][0]
    expect(opts.title).toContain('Foo')
    expect(opts.confirmText).toBe('Move to Trash')
    expect(opts.variant).toBe('danger')
  })

  it('execute does NOT call uninstall when user cancels', async () => {
    const svc = freshService()
    mockSearchOrchestrator.items = [makeAppResult()]
    mockSearchStores.selectedIndex = 0
    mockFeedbackService.confirmAlert.mockResolvedValueOnce(false)

    await svc.executeAction('uninstall_application')

    expect(mockApplicationService.uninstallApplication).not.toHaveBeenCalled()
    expect(mockFeedbackService.showHUD).not.toHaveBeenCalled()
  })

  it('execute calls uninstallApplication with the selected path and shows success HUD', async () => {
    const svc = freshService()
    mockSearchOrchestrator.items = [makeAppResult({ path: '/Applications/Bar.app', name: 'Bar' })]
    mockSearchStores.selectedIndex = 0

    await svc.executeAction('uninstall_application')

    expect(mockApplicationService.uninstallApplication).toHaveBeenCalledWith('/Applications/Bar.app')
    expect(mockFeedbackService.showHUD).toHaveBeenCalledWith('Moved to Trash')
  })

  it('execute surfaces a failure HUD when uninstall rejects', async () => {
    const svc = freshService()
    mockSearchOrchestrator.items = [makeAppResult()]
    mockSearchStores.selectedIndex = 0
    mockApplicationService.uninstallApplication.mockRejectedValueOnce(
      new Error('Permission denied: cannot uninstall system-protected application'),
    )

    await svc.executeAction('uninstall_application')

    expect(mockFeedbackService.showHUD).toHaveBeenCalledOnce()
    const hudArg = mockFeedbackService.showHUD.mock.calls[0][0]
    expect(hudArg).toMatch(/Uninstall failed/)
    expect(hudArg).toMatch(/system-protected/)
  })

  it('execute is a no-op when no item is selected', async () => {
    const svc = freshService()
    mockSearchStores.selectedIndex = -1

    await svc.executeAction('uninstall_application')

    expect(mockFeedbackService.confirmAlert).not.toHaveBeenCalled()
    expect(mockApplicationService.uninstallApplication).not.toHaveBeenCalled()
  })
})
