import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../../lib/ipc/commands', () => ({
  showHud: vi.fn(async () => {}),
  hideHud: vi.fn(async () => {}),
}))

import { feedbackService } from './feedbackService.svelte'

beforeEach(() => {
  feedbackService.reset()
})

describe('showToast', () => {
  it('sets activeToast immediately and returns an id', async () => {
    const id = await feedbackService.showToast({ title: 'Saved' })
    expect(typeof id).toBe('string')
    expect(id.length).toBeGreaterThan(0)
    expect(feedbackService.activeToast).not.toBeNull()
    expect(feedbackService.activeToast?.title).toBe('Saved')
    expect(feedbackService.activeToast?.id).toBe(id)
  })

  it('always uses "animated" style', async () => {
    await feedbackService.showToast({ title: 'Loading' })
    expect(feedbackService.activeToast?.style).toBe('animated')
  })

  it('does NOT auto-dismiss (animated is the only style)', async () => {
    await feedbackService.showToast({ title: 'Loading', style: 'animated' })
    // No timer should fire; toast stays indefinitely until hideToast is called
    expect(feedbackService.activeToast).not.toBeNull()
  })

  it('replaces the active toast when called again (only one at a time)', async () => {
    const firstId = await feedbackService.showToast({ title: 'First', style: 'animated' })
    const secondId = await feedbackService.showToast({ title: 'Second', style: 'animated' })
    expect(secondId).not.toBe(firstId)
    expect(feedbackService.activeToast?.id).toBe(secondId)
    expect(feedbackService.activeToast?.title).toBe('Second')
  })
})

describe('updateToast', () => {
  it('updates title in place when id matches', async () => {
    const id = await feedbackService.showToast({ title: 'Loading', style: 'animated' })
    await feedbackService.updateToast(id, { title: 'Still loading…' })
    expect(feedbackService.activeToast?.id).toBe(id)
    expect(feedbackService.activeToast?.title).toBe('Still loading…')
    expect(feedbackService.activeToast?.style).toBe('animated')
  })

  it('is a no-op when toast id does not match the active toast', async () => {
    await feedbackService.showToast({ title: 'Loading', style: 'animated' })
    const before = { ...feedbackService.activeToast! }
    await feedbackService.updateToast('toast-999', { title: 'Hijack' })
    expect(feedbackService.activeToast?.title).toBe(before.title)
    expect(feedbackService.activeToast?.style).toBe(before.style)
  })

  it('does not crash when no toast is active', async () => {
    expect(feedbackService.activeToast).toBeNull()
    await expect(
      feedbackService.updateToast('toast-1', { title: 'x' })
    ).resolves.toBeUndefined()
    expect(feedbackService.activeToast).toBeNull()
  })
})

describe('hideToast', () => {
  it('clears activeToast when id matches', async () => {
    const id = await feedbackService.showToast({ title: 'Saved', style: 'animated' })
    await feedbackService.hideToast(id)
    expect(feedbackService.activeToast).toBeNull()
  })

  it('is a no-op when id does not match the active toast', async () => {
    const id = await feedbackService.showToast({ title: 'Loading', style: 'animated' })
    await feedbackService.hideToast('toast-999')
    expect(feedbackService.activeToast?.id).toBe(id)
  })
})

describe('confirmAlert', () => {
  it('resolves true when onDialogConfirmed is called', async () => {
    const promise = feedbackService.confirmAlert({ title: 'Delete?', message: 'Sure?' })
    expect(feedbackService.activeDialog).not.toBeNull()
    expect(feedbackService.activeDialog?.title).toBe('Delete?')
    feedbackService.onDialogConfirmed()
    await expect(promise).resolves.toBe(true)
    expect(feedbackService.activeDialog).toBeNull()
  })

  it('resolves false when onDialogCancelled is called', async () => {
    const promise = feedbackService.confirmAlert({ title: 'Delete?', message: 'Sure?' })
    feedbackService.onDialogCancelled()
    await expect(promise).resolves.toBe(false)
    expect(feedbackService.activeDialog).toBeNull()
  })

  it('exposes confirmText, cancelText, and variant on activeDialog', async () => {
    const promise = feedbackService.confirmAlert({
      title: 'Uninstall',
      message: 'Sure?',
      confirmText: 'Yeet',
      cancelText: 'Nope',
      variant: 'danger',
    })
    expect(feedbackService.activeDialog?.confirmText).toBe('Yeet')
    expect(feedbackService.activeDialog?.cancelText).toBe('Nope')
    expect(feedbackService.activeDialog?.variant).toBe('danger')
    feedbackService.onDialogCancelled()
    await promise
  })

  it('returns false for a second concurrent call when a dialog is already open', async () => {
    const first = feedbackService.confirmAlert({ title: 'A', message: 'a' })
    expect(feedbackService.activeDialog?.title).toBe('A')
    // The second call must NOT throw — it resolves to false so callers
    // don't have to wrap confirmAlert in try/catch for a race condition.
    await expect(
      feedbackService.confirmAlert({ title: 'B', message: 'b' })
    ).resolves.toBe(false)
    // The first dialog must still be active and unchanged.
    expect(feedbackService.activeDialog?.title).toBe('A')
    feedbackService.onDialogCancelled()
    await expect(first).resolves.toBe(false)
  })
})

describe('showHUD', () => {
  it('invokes commands.showHud with the title and a default duration', async () => {
    const commands = await import('../../lib/ipc/commands')
    const showHud = commands.showHud as ReturnType<typeof vi.fn>
    showHud.mockClear()
    await feedbackService.showHUD('Brightness up')
    expect(showHud).toHaveBeenCalledTimes(1)
    const arg = showHud.mock.calls[0][0]
    expect(arg.title).toBe('Brightness up')
    expect(typeof arg.durationMs).toBe('number')
    expect(arg.durationMs).toBeGreaterThan(0)
  })
})
