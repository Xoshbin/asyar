import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../log/logService', () => ({
  logService: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

import { DeeplinkService, type DeeplinkDeps } from './deeplinkService.svelte'
import { logService } from '../log/logService'

function makeDeps(overrides?: Partial<DeeplinkDeps>): DeeplinkDeps {
  return {
    getManifestById: vi.fn().mockReturnValue(undefined),
    isExtensionEnabled: vi.fn().mockReturnValue(false),
    hasCommand: vi.fn().mockReturnValue(false),
    executeCommand: vi.fn().mockResolvedValue(undefined),
    navigateToView: vi.fn(),
    showWindow: vi.fn().mockResolvedValue(undefined),
    recordItemUsage: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

/** A minimal manifest with one no-view command. */
function makeManifest(overrides?: {
  commandId?: string
  resultType?: string
  defaultView?: string
  extensionType?: string
}) {
  const commandId = overrides?.commandId ?? 'run'
  const resultType = overrides?.resultType ?? 'no-view'
  return {
    id: 'com.example.ext',
    name: 'Test Extension',
    version: '1.0.0',
    description: '',
    type: overrides?.extensionType ?? 'result',
    defaultView: overrides?.defaultView,
    commands: [
      {
        id: commandId,
        name: 'Run',
        description: '',
        trigger: 'run',
        resultType,
      },
    ],
  }
}

describe('DeeplinkService.handleExtensionDeeplink', () => {
  let service: DeeplinkService
  let deps: DeeplinkDeps

  beforeEach(() => {
    vi.clearAllMocks()
    deps = makeDeps()
    service = new DeeplinkService(deps)
  })

  // ── Happy path: no-view ──────────────────────────────────────────────

  it('executes no-view command with correct objectId and args', async () => {
    const manifest = makeManifest()
    vi.mocked(deps.getManifestById).mockReturnValue(manifest)
    vi.mocked(deps.isExtensionEnabled).mockReturnValue(true)
    vi.mocked(deps.hasCommand).mockReturnValue(true)
    vi.mocked(deps.executeCommand).mockResolvedValue({ type: 'no-view' })

    await service.handleExtensionDeeplink({
      extensionId: 'com.example.ext',
      commandId: 'run',
      args: { city: 'Berlin' },
    })

    expect(deps.executeCommand).toHaveBeenCalledWith(
      'cmd_com.example.ext_run',
      expect.objectContaining({ city: 'Berlin', deeplinkTrigger: true }),
    )
  })

  it('does not show window for no-view commands', async () => {
    const manifest = makeManifest()
    vi.mocked(deps.getManifestById).mockReturnValue(manifest)
    vi.mocked(deps.isExtensionEnabled).mockReturnValue(true)
    vi.mocked(deps.hasCommand).mockReturnValue(true)
    vi.mocked(deps.executeCommand).mockResolvedValue({ type: 'no-view' })

    await service.handleExtensionDeeplink({
      extensionId: 'com.example.ext',
      commandId: 'run',
      args: {},
    })

    expect(deps.showWindow).not.toHaveBeenCalled()
  })

  // ── Happy path: view ─────────────────────────────────────────────────

  it('shows window and navigates for view commands', async () => {
    const manifest = makeManifest({
      resultType: 'view',
      defaultView: 'DefaultView',
    })
    vi.mocked(deps.getManifestById).mockReturnValue(manifest)
    vi.mocked(deps.isExtensionEnabled).mockReturnValue(true)
    vi.mocked(deps.hasCommand).mockReturnValue(true)
    vi.mocked(deps.executeCommand).mockResolvedValue({ type: 'view' })

    await service.handleExtensionDeeplink({
      extensionId: 'com.example.ext',
      commandId: 'run',
      args: {},
    })

    expect(deps.showWindow).toHaveBeenCalled()
    expect(deps.navigateToView).toHaveBeenCalledWith('com.example.ext/DefaultView')
  })

  it('shows window for view-type extension even when command resultType is no-view', async () => {
    const manifest = makeManifest({
      extensionType: 'view',
      resultType: 'no-view',
      defaultView: 'MainView',
    })
    vi.mocked(deps.getManifestById).mockReturnValue(manifest)
    vi.mocked(deps.isExtensionEnabled).mockReturnValue(true)
    vi.mocked(deps.hasCommand).mockReturnValue(true)
    vi.mocked(deps.executeCommand).mockResolvedValue({ type: 'no-view' })

    await service.handleExtensionDeeplink({
      extensionId: 'com.example.ext',
      commandId: 'run',
      args: {},
    })

    expect(deps.showWindow).toHaveBeenCalled()
    expect(deps.navigateToView).toHaveBeenCalledWith('com.example.ext/MainView')
  })

  // ── Validation: extension not found ──────────────────────────────────

  it('rejects unknown extensionId gracefully', async () => {
    vi.mocked(deps.getManifestById).mockReturnValue(undefined)

    await service.handleExtensionDeeplink({
      extensionId: 'unknown.ext',
      commandId: 'run',
      args: {},
    })

    expect(deps.executeCommand).not.toHaveBeenCalled()
    expect(logService.error).toHaveBeenCalled()
  })

  // ── Validation: extension disabled ───────────────────────────────────

  it('rejects disabled extension gracefully', async () => {
    const manifest = makeManifest()
    vi.mocked(deps.getManifestById).mockReturnValue(manifest)
    vi.mocked(deps.isExtensionEnabled).mockReturnValue(false)

    await service.handleExtensionDeeplink({
      extensionId: 'com.example.ext',
      commandId: 'run',
      args: {},
    })

    expect(deps.executeCommand).not.toHaveBeenCalled()
    expect(logService.error).toHaveBeenCalled()
  })

  // ── Validation: command not in manifest ──────────────────────────────

  it('rejects command that does not exist in manifest', async () => {
    const manifest = makeManifest()
    vi.mocked(deps.getManifestById).mockReturnValue(manifest)
    vi.mocked(deps.isExtensionEnabled).mockReturnValue(true)

    await service.handleExtensionDeeplink({
      extensionId: 'com.example.ext',
      commandId: 'nonexistent',
      args: {},
    })

    expect(deps.executeCommand).not.toHaveBeenCalled()
    expect(logService.error).toHaveBeenCalled()
  })

  // ── Validation: command not registered ───────────────────────────────

  it('rejects command not registered in commandService', async () => {
    const manifest = makeManifest()
    vi.mocked(deps.getManifestById).mockReturnValue(manifest)
    vi.mocked(deps.isExtensionEnabled).mockReturnValue(true)
    vi.mocked(deps.hasCommand).mockReturnValue(false)

    await service.handleExtensionDeeplink({
      extensionId: 'com.example.ext',
      commandId: 'run',
      args: {},
    })

    expect(deps.executeCommand).not.toHaveBeenCalled()
    expect(logService.error).toHaveBeenCalled()
  })

  // ── deeplinkTrigger flag ─────────────────────────────────────────────

  it('passes deeplinkTrigger: true in args to executeCommand', async () => {
    const manifest = makeManifest()
    vi.mocked(deps.getManifestById).mockReturnValue(manifest)
    vi.mocked(deps.isExtensionEnabled).mockReturnValue(true)
    vi.mocked(deps.hasCommand).mockReturnValue(true)
    vi.mocked(deps.executeCommand).mockResolvedValue({ type: 'no-view' })

    await service.handleExtensionDeeplink({
      extensionId: 'com.example.ext',
      commandId: 'run',
      args: { key: 'val' },
    })

    const callArgs = vi.mocked(deps.executeCommand).mock.calls[0][1]
    expect(callArgs).toHaveProperty('deeplinkTrigger', true)
  })

  // ── Usage recording ──────────────────────────────────────────────────

  it('records usage after successful execution', async () => {
    const manifest = makeManifest()
    vi.mocked(deps.getManifestById).mockReturnValue(manifest)
    vi.mocked(deps.isExtensionEnabled).mockReturnValue(true)
    vi.mocked(deps.hasCommand).mockReturnValue(true)
    vi.mocked(deps.executeCommand).mockResolvedValue({ type: 'no-view' })

    await service.handleExtensionDeeplink({
      extensionId: 'com.example.ext',
      commandId: 'run',
      args: {},
    })

    expect(deps.recordItemUsage).toHaveBeenCalledWith('cmd_com.example.ext_run')
  })

  it('does not record usage after failed execution', async () => {
    const manifest = makeManifest()
    vi.mocked(deps.getManifestById).mockReturnValue(manifest)
    vi.mocked(deps.isExtensionEnabled).mockReturnValue(true)
    vi.mocked(deps.hasCommand).mockReturnValue(true)
    vi.mocked(deps.executeCommand).mockRejectedValue(new Error('boom'))

    await service.handleExtensionDeeplink({
      extensionId: 'com.example.ext',
      commandId: 'run',
      args: {},
    })

    expect(deps.recordItemUsage).not.toHaveBeenCalled()
  })

  // ── Empty args ───────────────────────────────────────────────────────

  it('handles empty args map correctly', async () => {
    const manifest = makeManifest()
    vi.mocked(deps.getManifestById).mockReturnValue(manifest)
    vi.mocked(deps.isExtensionEnabled).mockReturnValue(true)
    vi.mocked(deps.hasCommand).mockReturnValue(true)
    vi.mocked(deps.executeCommand).mockResolvedValue({ type: 'no-view' })

    await service.handleExtensionDeeplink({
      extensionId: 'com.example.ext',
      commandId: 'run',
      args: {},
    })

    expect(deps.executeCommand).toHaveBeenCalledWith(
      'cmd_com.example.ext_run',
      { deeplinkTrigger: true },
    )
  })

  // ── Store browse with slug (Open in Asyar) ──────────────────────────

  it('passes slug arg to store browse command for Open in Asyar deeplink', async () => {
    const storeManifest = {
      id: 'store',
      name: 'Store',
      version: '1.0.0',
      description: '',
      type: 'view' as const,
      defaultView: undefined,
      commands: [
        {
          id: 'browse',
          name: 'Browse Extension Store',
          description: '',
          trigger: 'store',
          resultType: undefined,
        },
      ],
    }
    vi.mocked(deps.getManifestById).mockReturnValue(storeManifest)
    vi.mocked(deps.isExtensionEnabled).mockReturnValue(true)
    vi.mocked(deps.hasCommand).mockReturnValue(true)
    vi.mocked(deps.executeCommand).mockResolvedValue({ success: true })

    await service.handleExtensionDeeplink({
      extensionId: 'store',
      commandId: 'browse',
      args: { slug: 'pomodoro-timer' },
    })

    expect(deps.showWindow).toHaveBeenCalled()
    expect(deps.executeCommand).toHaveBeenCalledWith(
      'cmd_store_browse',
      expect.objectContaining({
        slug: 'pomodoro-timer',
        deeplinkTrigger: true,
      }),
    )
  })
})
