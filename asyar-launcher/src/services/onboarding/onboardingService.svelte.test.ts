import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('../log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('../diagnostics/diagnosticsService.svelte', () => ({
  diagnosticsService: { report: vi.fn() },
}))

import { onboardingService } from './onboardingService.svelte'
import { invoke } from '@tauri-apps/api/core'
import type { MockedFunction } from 'vitest'

const mockInvoke = invoke as MockedFunction<typeof invoke>

const initialState = {
  current: 'welcome',
  total: 7,
  position: 1,
  isMacos: true,
}

describe('onboardingService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    onboardingService.reset()
  })

  it('loads initial state from Rust', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(initialState)
    await onboardingService.load()
    expect(invoke).toHaveBeenCalledWith('get_onboarding_state')
    expect(onboardingService.state).toEqual(initialState)
  })

  it('advances and stores returned state', async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce(initialState)
      .mockResolvedValueOnce({
        ...initialState,
        current: 'grantAccessibility',
        position: 2,
      })
    await onboardingService.load()
    await onboardingService.advance()
    expect(invoke).toHaveBeenCalledWith('advance_onboarding_step')
    expect(onboardingService.state?.current).toBe('grantAccessibility')
  })

  it('goes back and stores returned state', async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce({ ...initialState, current: 'pickHotkey', position: 3 })
      .mockResolvedValueOnce({ ...initialState, current: 'grantAccessibility', position: 2 })
    await onboardingService.load()
    await onboardingService.goBack()
    expect(invoke).toHaveBeenCalledWith('go_back_onboarding_step')
    expect(onboardingService.state?.current).toBe('grantAccessibility')
  })

  it('completes calls Rust', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined)
    await onboardingService.complete()
    expect(invoke).toHaveBeenCalledWith('complete_onboarding')
  })

  it('dismiss calls Rust', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined)
    await onboardingService.dismiss()
    expect(invoke).toHaveBeenCalledWith('dismiss_onboarding')
  })

  it('reports diagnostics on load failure', async () => {
    const { diagnosticsService } = await import(
      '../diagnostics/diagnosticsService.svelte'
    )
    vi.mocked(invoke).mockRejectedValueOnce(new Error('boom'))
    await onboardingService.load()
    expect(diagnosticsService.report).toHaveBeenCalled()
  })
})

describe('skipAiSetup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    onboardingService.reset()
  })

  it('advances past the single aiSetup step to done', async () => {
    const aiSetupState = { current: 'aiSetup', total: 7, position: 6, isMacos: false }
    const doneState = { current: 'done', total: 7, position: 7, isMacos: false }
    // seed current state as aiSetup
    onboardingService.state = aiSetupState as any
    // advance returns done
    mockInvoke.mockResolvedValueOnce(doneState)

    await onboardingService.skipAiSetup()

    expect(onboardingService.state?.current).toBe('done')
    expect(mockInvoke).toHaveBeenCalledTimes(1)
  })
})

describe('AI onboarding', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    onboardingService.reset()
  })

  it('initializes aiCompleted to false', () => {
    expect(onboardingService.aiCompleted).toBe(false)
  })

  it('loadAi sets aiCompleted from the IPC reply', async () => {
    mockInvoke.mockResolvedValueOnce(true)
    await onboardingService.loadAi()
    expect(mockInvoke).toHaveBeenCalledWith('is_ai_onboarding_completed')
    expect(onboardingService.aiCompleted).toBe(true)
  })

  it('completeAi calls the IPC and flips aiCompleted to true', async () => {
    mockInvoke.mockResolvedValueOnce(undefined)
    await onboardingService.completeAi()
    expect(mockInvoke).toHaveBeenCalledWith('complete_ai_onboarding')
    expect(onboardingService.aiCompleted).toBe(true)
  })
})
