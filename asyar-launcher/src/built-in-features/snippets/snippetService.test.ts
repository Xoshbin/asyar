import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockInvoke = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const mockWriteText = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const mockGetAll = vi.hoisted(() => vi.fn().mockReturnValue([]))
const mockLoad = vi.hoisted(() => vi.fn().mockResolvedValue(true))
const mockLoadSync = vi.hoisted(() => vi.fn().mockReturnValue(true))
const mockSave = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const mockWarn = vi.hoisted(() => vi.fn())

vi.mock('@tauri-apps/api/core', () => ({ invoke: mockInvoke }))
vi.mock('tauri-plugin-clipboard-x-api', () => ({ writeText: mockWriteText }))
vi.mock('./snippetStore.svelte', () => ({
  snippetStore: { 
    getAll: mockGetAll,
    snippets: [],
  },
}))

vi.mock('../../lib/persistence/extensionStore', () => ({
  createPersistence: vi.fn().mockReturnValue({
    load: mockLoad,
    loadSync: mockLoadSync,
    save: mockSave,
  }),
}))

vi.mock('../../services/log/logService', () => ({
  logService: { warn: mockWarn }
}))

import { snippetService } from './snippetService'

beforeEach(() => {
  mockInvoke.mockClear().mockResolvedValue(undefined)
  mockWriteText.mockClear().mockResolvedValue(undefined)
  mockGetAll.mockClear().mockReturnValue([])
  mockLoad.mockClear().mockResolvedValue(true)
  mockLoadSync.mockClear().mockReturnValue(true)
  mockSave.mockClear().mockResolvedValue(undefined)
  mockWarn.mockClear()
})

// ── init ───────────────────────────────────────────────────────────────────────

describe('init', () => {
  it('calls syncToRust and setEnabled(true) when permission is granted and enabled=true', async () => {
    mockInvoke.mockResolvedValueOnce(true) // check_snippet_permission
    mockLoad.mockResolvedValueOnce(true) // enabledPersistence.load
    
    await snippetService.init()
    
    expect(mockInvoke).toHaveBeenCalledWith('sync_snippets_to_rust', { snippets: [] })
    expect(mockInvoke).toHaveBeenCalledWith('set_snippets_enabled', { enabled: true })
  })

  it('calls syncToRust but NOT setEnabled when permission is granted but enabled=false', async () => {
    mockInvoke.mockResolvedValueOnce(true) // check_snippet_permission
    mockLoad.mockResolvedValueOnce(false) // enabledPersistence.load
    
    await snippetService.init()
    
    expect(mockInvoke).toHaveBeenCalledWith('sync_snippets_to_rust', { snippets: [] })
    expect(mockInvoke).not.toHaveBeenCalledWith('set_snippets_enabled', expect.anything())
  })

  it('does nothing when permission is denied', async () => {
    mockInvoke.mockResolvedValueOnce(false) // check_snippet_permission
    
    await snippetService.init()
    
    expect(mockInvoke).not.toHaveBeenCalledWith('sync_snippets_to_rust', expect.anything())
    expect(mockInvoke).not.toHaveBeenCalledWith('set_snippets_enabled', expect.anything())
  })

  it('catches errors and logs warning', async () => {
    mockInvoke.mockImplementationOnce(() => { throw new Error('fail') })
    
    await snippetService.init()
    
    expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining('fail'))
  })
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

  it('suppresses concurrent expansions', async () => {
    let resolveFirst: (v: any) => void
    const firstPromise = new Promise(resolve => { resolveFirst = resolve })
    
    // First call hangs at writeText
    mockWriteText.mockReturnValueOnce(firstPromise)
    
    const p1 = snippetService.expandSnippet(4, 'first')
    const p2 = snippetService.expandSnippet(4, 'second')

    resolveFirst!(undefined)
    await Promise.all([p1, p2])

    expect(mockWriteText).toHaveBeenCalledTimes(1)
    expect(mockWriteText).toHaveBeenCalledWith('first')
    expect(mockInvoke).toHaveBeenCalledTimes(1)
  })

  it('allows sequential expansions', async () => {
    await snippetService.expandSnippet(4, 'first')
    await snippetService.expandSnippet(4, 'second')
    
    expect(mockWriteText).toHaveBeenCalledTimes(2)
    expect(mockWriteText).toHaveBeenNthCalledWith(1, 'first')
    expect(mockWriteText).toHaveBeenNthCalledWith(2, 'second')
    expect(mockInvoke).toHaveBeenCalledTimes(2)
  })

  it('resets flag even on error', async () => {
    mockWriteText.mockRejectedValueOnce(new Error('fail'))
    
    await expect(snippetService.expandSnippet(4, 'error')).rejects.toThrow('fail')
    
    // Next call should succeed
    await snippetService.expandSnippet(4, 'success')
    expect(mockWriteText).toHaveBeenCalledTimes(2)
    expect(mockInvoke).toHaveBeenCalledTimes(1)
    expect(mockWriteText).toHaveBeenNthCalledWith(2, 'success')
  })
})
