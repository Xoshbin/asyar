import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockInvoke = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const mockWriteText = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const mockGetAll = vi.hoisted(() => vi.fn().mockReturnValue([]))

vi.mock('@tauri-apps/api/core', () => ({ invoke: mockInvoke }))
vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({ writeText: mockWriteText }))
vi.mock('./snippetStore', () => ({
  snippetStore: { getAll: mockGetAll },
}))

import { snippetService } from './snippetService'

beforeEach(() => {
  mockInvoke.mockClear()
  mockWriteText.mockClear()
  mockGetAll.mockClear()
  mockGetAll.mockReturnValue([])
})

// ── onViewOpen ─────────────────────────────────────────────────────────────────

describe('onViewOpen', () => {
  it('returns { permissionGranted: true } and syncs when permission is granted', async () => {
    mockInvoke.mockResolvedValueOnce(true) // check_snippet_permission
    const result = await snippetService.onViewOpen()
    expect(result).toEqual({ permissionGranted: true })
    // After permission granted, syncToRust is called
    expect(mockInvoke).toHaveBeenCalledWith('sync_snippets_to_rust', { snippets: [] })
  })

  it('returns { permissionGranted: false } and does not sync when permission is denied', async () => {
    mockInvoke.mockResolvedValueOnce(false) // check_snippet_permission
    const result = await snippetService.onViewOpen()
    expect(result).toEqual({ permissionGranted: false })
    expect(mockInvoke).not.toHaveBeenCalledWith('sync_snippets_to_rust', expect.anything())
  })
})

// ── syncToRust ─────────────────────────────────────────────────────────────────

describe('syncToRust', () => {
  it('invokes sync_snippets_to_rust with keyword-expansion pairs from the store', async () => {
    mockGetAll.mockReturnValue([
      { id: '1', keyword: ';addr', expansion: '123 Main St', name: 'Address', createdAt: 0 },
      { id: '2', keyword: ';sig', expansion: 'Kind regards', name: 'Signature', createdAt: 0 },
    ])
    await snippetService.syncToRust()
    expect(mockInvoke).toHaveBeenCalledWith('sync_snippets_to_rust', {
      snippets: [[';addr', '123 Main St'], [';sig', 'Kind regards']],
    })
  })

  it('passes an empty array when the store has no snippets', async () => {
    await snippetService.syncToRust()
    expect(mockInvoke).toHaveBeenCalledWith('sync_snippets_to_rust', { snippets: [] })
  })
})

// ── setEnabled ─────────────────────────────────────────────────────────────────

describe('setEnabled', () => {
  it('returns { ok: true } when invoke succeeds', async () => {
    expect(await snippetService.setEnabled(true)).toEqual({ ok: true })
    expect(mockInvoke).toHaveBeenCalledWith('set_snippets_enabled', { enabled: true })
  })

  it('passes enabled=false to the Rust command', async () => {
    await snippetService.setEnabled(false)
    expect(mockInvoke).toHaveBeenCalledWith('set_snippets_enabled', { enabled: false })
  })

  it('returns { ok: false, error } when invoke rejects', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('permission denied'))
    const result = await snippetService.setEnabled(true)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('permission denied')
  })
})

// ── openAccessibilityPreferences ──────────────────────────────────────────────

describe('openAccessibilityPreferences', () => {
  it('invokes open_accessibility_preferences', async () => {
    await snippetService.openAccessibilityPreferences()
    expect(mockInvoke).toHaveBeenCalledWith('open_accessibility_preferences')
  })
})

// ── expandSnippet ─────────────────────────────────────────────────────────────

describe('expandSnippet', () => {
  it('writes the expansion to clipboard then invokes expand_and_paste', async () => {
    await snippetService.expandSnippet(4, 'hello world')
    expect(mockWriteText).toHaveBeenCalledWith('hello world')
    expect(mockInvoke).toHaveBeenCalledWith('expand_and_paste', { keywordLen: 4 })
  })

  it('calls writeText before invoke', async () => {
    const order: string[] = []
    mockWriteText.mockImplementationOnce(async () => { order.push('write') })
    mockInvoke.mockImplementationOnce(async () => { order.push('invoke') })
    await snippetService.expandSnippet(3, 'foo')
    expect(order).toEqual(['write', 'invoke'])
  })
})
