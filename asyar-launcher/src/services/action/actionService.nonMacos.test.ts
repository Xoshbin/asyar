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

// Force Linux for this file; HOST_PLATFORM is captured at module-load so a
// separate test file is required to cover the unsupported-platform path.
vi.mock('@tauri-apps/plugin-os', () => ({
  platform: () => 'linux',
}))

// Import AFTER mocks so module-level platform detection evaluates to 'other'.
import { ActionService } from './actionService.svelte'

describe('uninstall_application visibility on Linux', () => {
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
        path: '/usr/share/applications/foo.desktop',
      },
    ]
    mockSearchStores.selectedIndex = 0

    const action = svc.getAllActions().find(a => a.id === 'uninstall_application')
    expect(action).toBeDefined()
    expect(action!.context).toBe(ActionContext.CORE)
    expect(action!.visible!()).toBe(false)
  })
})
