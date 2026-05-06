import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn().mockResolvedValue(vi.fn()) }))
vi.mock('../envService', () => ({
  envService: { storeApiBaseUrl: 'http://localhost' },
}))
vi.mock('../log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('../settings/settingsService.svelte', () => ({
  settingsService: {
    currentSettings: {
      extensions: { autoUpdate: true },
    },
  },
}))
vi.mock('../../lib/ipc/commands', () => ({
  checkExtensionUpdates: vi.fn().mockResolvedValue([]),
  updateAllExtensions: vi.fn(),
  updateExtension: vi.fn(),
}))

describe('extensionUpdateService', () => {
  let extensionUpdateService: any
  let listen: any
  let commands: any

  beforeEach(async () => {
    vi.resetModules()
    ;({ extensionUpdateService } = await import('./extensionUpdateService.svelte'))
    ;({ listen } = await import('@tauri-apps/api/event'))
    commands = await import('../../lib/ipc/commands')
    // Reset call history only, keep mock implementations from factory
    vi.mocked(listen).mockClear()
    vi.mocked(listen).mockResolvedValue(vi.fn())
    vi.mocked(commands.checkExtensionUpdates).mockClear()
  })

  it('init() subscribes to asyar:extension-update:tick and calls checkAndAutoApply when the event fires', async () => {
    await extensionUpdateService.init(() => null, async () => {})

    // listen must have been called with the tick event
    const listenCalls = vi.mocked(listen).mock.calls
    const tickCall = listenCalls.find(([eventName]: [string]) => eventName === 'asyar:extension-update:tick')
    expect(tickCall).toBeDefined()

    // Invoking the captured handler should trigger checkAndAutoApply → checkForUpdates
    const handler = tickCall![1] as () => void
    await handler()

    expect(commands.checkExtensionUpdates).toHaveBeenCalled()
  })

  it('destroy() calls the tick unlisten function', async () => {
    const mockUnlisten = vi.fn()
    vi.mocked(listen).mockResolvedValue(mockUnlisten)

    await extensionUpdateService.init(() => null, async () => {})
    extensionUpdateService.destroy()

    expect(mockUnlisten).toHaveBeenCalled()
  })
})
