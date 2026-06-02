import { describe, it, expect, vi, beforeEach } from 'vitest'

const add = vi.hoisted(() => vi.fn())
const snippets = vi.hoisted(() => vi.fn().mockReturnValue([]))
const setEnabled = vi.hoisted(() => vi.fn().mockResolvedValue({ ok: true }))
const syncToRust = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))

vi.mock('../../../built-in-features/snippets/snippetStore.svelte', () => ({
  snippetStore: { add, get snippets() { return snippets() } },
}))
vi.mock('../../../built-in-features/snippets/snippetService', () => ({
  snippetService: { setEnabled, syncToRust },
}))

import { seedSampleSnippet, enableExpansion } from './snippetsSetup'

describe('Snippets setup', () => {
  beforeEach(() => vi.clearAllMocks())
  it('seeds a ;email snippet once', () => {
    seedSampleSnippet()
    expect(add).toHaveBeenCalledTimes(1)
    expect(add.mock.calls[0][0].keyword).toBe(';email')
  })
  it('does not duplicate an existing ;email snippet', () => {
    snippets.mockReturnValueOnce([{ id: '1', keyword: ';email', expansion: 'x', name: 'Email', createdAt: 0 }])
    seedSampleSnippet()
    expect(add).not.toHaveBeenCalled()
  })
  it('syncs and enables background expansion', async () => {
    const ok = await enableExpansion()
    expect(syncToRust).toHaveBeenCalled()
    expect(setEnabled).toHaveBeenCalledWith(true)
    expect(ok).toBe(true)
  })
})
