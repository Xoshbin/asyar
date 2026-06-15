import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock before importing the module under test
vi.mock('../../lib/ipc/commands', () => ({
  getPendingCrash: vi.fn(async () => null),
  sendPendingCrash: vi.fn(async () => {}),
  dismissPendingCrash: vi.fn(async () => {}),
}))

import { crashPromptState } from './crashPromptState.svelte'

beforeEach(() => {
  crashPromptState.reset()
  vi.clearAllMocks()
})

describe('load', () => {
  it('sets visible=true and payload when a crash exists', async () => {
    const { getPendingCrash } = await import('../../lib/ipc/commands')
    const mockPayload = { panic: 'test panic', backtrace: 'bt line', log_tail: 'log tail' }
    vi.mocked(getPendingCrash).mockResolvedValue(mockPayload)

    await crashPromptState.load()

    expect(crashPromptState.visible).toBe(true)
    expect(crashPromptState.payload).toEqual(mockPayload)
  })

  it('stays hidden when getPendingCrash returns null', async () => {
    const { getPendingCrash } = await import('../../lib/ipc/commands')
    vi.mocked(getPendingCrash).mockResolvedValue(null)

    await crashPromptState.load()

    expect(crashPromptState.visible).toBe(false)
    expect(crashPromptState.payload).toBeNull()
  })
})

describe('send', () => {
  it('calls sendPendingCrash with entered email then hides', async () => {
    const { getPendingCrash, sendPendingCrash } = await import('../../lib/ipc/commands')
    const mockPayload = { panic: 'p', backtrace: 'b', log_tail: 'l' }
    vi.mocked(getPendingCrash).mockResolvedValue(mockPayload)
    vi.mocked(sendPendingCrash).mockResolvedValue(undefined)

    await crashPromptState.load()
    crashPromptState.email = 'user@example.com'
    await crashPromptState.send()

    expect(sendPendingCrash).toHaveBeenCalledWith('user@example.com')
    expect(crashPromptState.visible).toBe(false)
    expect(crashPromptState.payload).toBeNull()
  })

  it('calls sendPendingCrash with empty string when email is cleared (anonymous)', async () => {
    const { getPendingCrash, sendPendingCrash } = await import('../../lib/ipc/commands')
    const mockPayload = { panic: 'p', backtrace: 'b', log_tail: 'l' }
    vi.mocked(getPendingCrash).mockResolvedValue(mockPayload)
    vi.mocked(sendPendingCrash).mockResolvedValue(undefined)

    await crashPromptState.load()
    crashPromptState.email = ''
    await crashPromptState.send()

    expect(sendPendingCrash).toHaveBeenCalledWith('')
    expect(crashPromptState.visible).toBe(false)
  })
})

describe('dismiss', () => {
  it('calls dismissPendingCrash and hides', async () => {
    const { getPendingCrash, dismissPendingCrash } = await import('../../lib/ipc/commands')
    const mockPayload = { panic: 'p', backtrace: 'b', log_tail: 'l' }
    vi.mocked(getPendingCrash).mockResolvedValue(mockPayload)

    await crashPromptState.load()
    expect(crashPromptState.visible).toBe(true)

    await crashPromptState.dismiss()

    expect(dismissPendingCrash).toHaveBeenCalledTimes(1)
    expect(crashPromptState.visible).toBe(false)
    expect(crashPromptState.payload).toBeNull()
  })
})
