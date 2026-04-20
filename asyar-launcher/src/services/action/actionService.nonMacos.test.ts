import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ActionContext } from 'asyar-sdk'

vi.mock('../log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('../search/SearchService', () => ({ searchService: { resetIndex: vi.fn() } }))
vi.mock('tauri-plugin-clipboard-x-api', () => ({ writeText: vi.fn().mockResolvedValue(undefined) }))

const mockSearchOrchestrator = vi.hoisted(() => ({ items: [] as any[] }))
vi.mock('../search/searchOrchestrator.svelte', () => ({ searchOrchestrator: mockSearchOrchestrator }))

const mockSearchStores = vi.hoisted(() => ({ selectedIndex: -1 }))
vi.mock('../search/stores/search.svelte', () => ({ searchStores: mockSearchStores }))

vi.mock('../feedback/feedbackService.svelte', () => ({
  feedbackService: { showHUD: vi.fn(), confirmAlert: vi.fn() },
}))
vi.mock('../application/applicationService', () => ({
  applicationService: { uninstallApplication: vi.fn() },
}))

// Force non-macOS for this file; IS_MACOS is captured at module-load.
vi.mock('@tauri-apps/plugin-os', () => ({
  platform: () => 'linux',
}))

// Import AFTER mocks so module-level IS_MACOS evaluates to false.
import { ActionService } from './actionService.svelte'

describe('uninstall_application visibility on non-macOS', () => {
  beforeEach(() => {
    mockSearchStores.selectedIndex = -1
    mockSearchOrchestrator.items = []
  })

  it('is hidden even for a valid user-installed application path', () => {
    const svc = new ActionService()
    mockSearchOrchestrator.items = [
      {
        objectId: 'app_foo',
        name: 'Foo',
        type: 'application' as const,
        score: 1,
        path: '/Applications/Foo.app',
      },
    ]
    mockSearchStores.selectedIndex = 0

    const action = svc.getAllActions().find(a => a.id === 'uninstall_application')
    expect(action).toBeDefined()
    expect(action!.context).toBe(ActionContext.CORE)
    expect(action!.visible!()).toBe(false)
  })
})
