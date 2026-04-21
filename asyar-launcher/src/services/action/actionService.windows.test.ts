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

// Pin platform detection to Windows for every test in this file.
vi.mock('@tauri-apps/plugin-os', () => ({
  platform: () => 'windows',
}))

// Import AFTER mocks so module-level HOST_PLATFORM resolves to 'windows'.
import { ActionService } from './actionService.svelte'

function makeLnkResult(overrides: Partial<{ path: string; name: string }> = {}) {
  return {
    objectId: 'app_Firefox_start_menu',
    name: overrides.name ?? 'Firefox',
    type: 'application' as const,
    score: 1,
    path:
      overrides.path ??
      'C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs\\Firefox.lnk',
  }
}

describe('uninstall_application on Windows', () => {
  beforeEach(() => {
    mockSearchStores.selectedIndex = -1
    mockSearchOrchestrator.items = []
    mockApplicationService.uninstallApplication.mockReset().mockResolvedValue(undefined)
    mockFeedbackService.showHUD.mockReset().mockResolvedValue(undefined)
    mockFeedbackService.confirmAlert.mockReset().mockResolvedValue(true)
  })

  it('is registered as a built-in action in CORE context', () => {
    const svc = new ActionService()
    const action = svc.getAllActions().find(a => a.id === 'uninstall_application')
    expect(action).toBeDefined()
    expect(action!.context).toBe(ActionContext.CORE)
  })

  it('description reflects the uninstaller-launch flow (not Trash)', () => {
    const svc = new ActionService()
    const action = svc.getAllActions().find(a => a.id === 'uninstall_application')
    expect(action!.description).toMatch(/installer/i)
    expect(action!.description).not.toMatch(/trash/i)
  })

  it('visible returns true for a normal .lnk shortcut', () => {
    const svc = new ActionService()
    mockSearchOrchestrator.items = [makeLnkResult()]
    mockSearchStores.selectedIndex = 0
    const action = svc.getAllActions().find(a => a.id === 'uninstall_application')
    expect(action!.visible!()).toBe(true)
  })

  it('visible returns false when no path is present', () => {
    const svc = new ActionService()
    mockSearchOrchestrator.items = [{ ...makeLnkResult(), path: undefined } as any]
    mockSearchStores.selectedIndex = 0
    const action = svc.getAllActions().find(a => a.id === 'uninstall_application')
    expect(action!.visible!()).toBe(false)
  })

  it('visible returns false for non-application items (e.g. commands)', () => {
    const svc = new ActionService()
    mockSearchOrchestrator.items = [
      {
        objectId: 'cmd_com.example_do',
        name: 'do',
        type: 'command' as const,
        score: 1,
        extensionId: 'com.example',
      },
    ]
    mockSearchStores.selectedIndex = 0
    const action = svc.getAllActions().find(a => a.id === 'uninstall_application')
    expect(action!.visible!()).toBe(false)
  })

  it('visible does NOT apply the /System/ prefix rule on Windows', () => {
    // A Windows path literally starting with "/System/" is implausible, but
    // we still document that the macOS-specific UI gate doesn't bleed over.
    // The defence-in-depth stays on the Rust side (registry SystemComponent).
    const svc = new ActionService()
    mockSearchOrchestrator.items = [
      makeLnkResult({ path: '/System/weird/but/technically/allowed.lnk' }),
    ]
    mockSearchStores.selectedIndex = 0
    const action = svc.getAllActions().find(a => a.id === 'uninstall_application')
    expect(action!.visible!()).toBe(true)
  })

  it('execute uses Windows-specific confirm copy and button label', async () => {
    const svc = new ActionService()
    mockSearchOrchestrator.items = [makeLnkResult({ name: 'Firefox' })]
    mockSearchStores.selectedIndex = 0

    await svc.executeAction('uninstall_application')

    expect(mockFeedbackService.confirmAlert).toHaveBeenCalledOnce()
    const opts = mockFeedbackService.confirmAlert.mock.calls[0][0]
    expect(opts.title).toBe('Uninstall Firefox?')
    expect(opts.message).toMatch(/launch the uninstaller/i)
    expect(opts.message).not.toMatch(/trash/i)
    expect(opts.confirmText).toBe('Open Uninstaller')
    expect(opts.variant).toBe('danger')
  })

  it('execute calls uninstallApplication with the .lnk path on confirm', async () => {
    const svc = new ActionService()
    const lnkPath =
      'C:\\Users\\test\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Slack.lnk'
    mockSearchOrchestrator.items = [makeLnkResult({ path: lnkPath, name: 'Slack' })]
    mockSearchStores.selectedIndex = 0

    await svc.executeAction('uninstall_application')

    expect(mockApplicationService.uninstallApplication).toHaveBeenCalledWith(lnkPath)
    expect(mockFeedbackService.showHUD).toHaveBeenCalledWith('Uninstaller launched')
  })

  it('execute surfaces a failure HUD when Rust rejects', async () => {
    const svc = new ActionService()
    mockSearchOrchestrator.items = [makeLnkResult({ name: 'Firefox' })]
    mockSearchStores.selectedIndex = 0
    mockApplicationService.uninstallApplication.mockRejectedValueOnce(
      new Error('no uninstall registry entry matches \'Firefox\''),
    )

    await svc.executeAction('uninstall_application')

    expect(mockFeedbackService.showHUD).toHaveBeenCalledOnce()
    const hudArg = mockFeedbackService.showHUD.mock.calls[0][0]
    expect(hudArg).toMatch(/Uninstall failed/)
    expect(hudArg).toMatch(/no uninstall registry entry/i)
  })

  it('execute does not call uninstall when user cancels', async () => {
    const svc = new ActionService()
    mockSearchOrchestrator.items = [makeLnkResult()]
    mockSearchStores.selectedIndex = 0
    mockFeedbackService.confirmAlert.mockResolvedValueOnce(false)

    await svc.executeAction('uninstall_application')

    expect(mockApplicationService.uninstallApplication).not.toHaveBeenCalled()
    expect(mockFeedbackService.showHUD).not.toHaveBeenCalled()
  })
})
