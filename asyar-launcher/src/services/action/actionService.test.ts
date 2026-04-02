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

// Reset the singleton before each test so tests are isolated
function freshService(): ActionService {
  ;(ActionService as any).instance = undefined
  return ActionService.getInstance()
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
