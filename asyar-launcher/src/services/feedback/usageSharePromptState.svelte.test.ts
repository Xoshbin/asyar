import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock before importing the module under test
vi.mock('../../lib/ipc/commands', () => ({
  sendPendingUsage: vi.fn().mockResolvedValue(undefined),
}))

import { sendPendingUsage } from '../../lib/ipc/commands'
import { usageSharePromptState } from './usageSharePromptState.svelte'

beforeEach(() => {
  usageSharePromptState.dismiss()
  vi.clearAllMocks()
})

describe('show', () => {
  it('sets pendingDay to the given day', () => {
    usageSharePromptState.show('2026-06-15')
    expect(usageSharePromptState.pendingDay).toBe('2026-06-15')
  })
})

describe('confirm', () => {
  it('sends the pending day then clears pendingDay', async () => {
    usageSharePromptState.show('2026-06-15')
    expect(usageSharePromptState.pendingDay).toBe('2026-06-15')

    await usageSharePromptState.confirm()

    expect(sendPendingUsage).toHaveBeenCalledWith('2026-06-15')
    expect(usageSharePromptState.pendingDay).toBeNull()
  })

  it('does nothing when there is no pending day', async () => {
    await usageSharePromptState.confirm()
    expect(sendPendingUsage).not.toHaveBeenCalled()
    expect(usageSharePromptState.pendingDay).toBeNull()
  })
})

describe('dismiss', () => {
  it('clears pendingDay without sending', () => {
    usageSharePromptState.show('2026-06-15')
    usageSharePromptState.dismiss()
    expect(usageSharePromptState.pendingDay).toBeNull()
    expect(sendPendingUsage).not.toHaveBeenCalled()
  })
})
