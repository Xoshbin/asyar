import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

vi.mock('../envService', () => ({ envService: { isBrowser: false } }))

import { SearchService } from './SearchService'
import { invoke } from '@tauri-apps/api/core'
import { envService } from '../envService'

function getInstance() {
  return new SearchService()
}

function resetMocks() {
  vi.mocked(invoke).mockClear()
  ;(envService as any).isBrowser = false
}

// ── performSearch ─────────────────────────────────────────────────────────────

describe('performSearch', () => {
  beforeEach(resetMocks)

  it('delegates to invoke in Tauri mode', async () => {
    const results = [{ objectId: 'app_1', name: 'Finder', type: 'app', score: 1 }]
    vi.mocked(invoke).mockResolvedValueOnce(results)

    const got = await getInstance().performSearch('find')

    expect(invoke).toHaveBeenCalledWith('search_items', { query: 'find' })
    expect(got).toEqual(results)
  })

  it('returns empty array when invoke throws', async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error('backend error'))
    const got = await getInstance().performSearch('x')
    expect(got).toEqual([])
  })

  it('returns browser fallbacks in browser mode', async () => {
    ;(envService as any).isBrowser = true
    const got = await getInstance().performSearch('')
    expect(invoke).not.toHaveBeenCalled()
    expect(got.length).toBeGreaterThan(0)
  })

  it('filters browser fallbacks by query match', async () => {
    ;(envService as any).isBrowser = true
    const got = await getInstance().performSearch('clipboard')
    expect(got.every(r =>
      r.name.toLowerCase().includes('clipboard') ||
      r.description?.toLowerCase().includes('clipboard')
    )).toBe(true)
  })

  it('returns empty array when browser query matches nothing', async () => {
    ;(envService as any).isBrowser = true
    const got = await getInstance().performSearch('zzznomatch')
    expect(got).toEqual([])
  })
})

// ── indexItem ─────────────────────────────────────────────────────────────────

describe('indexItem', () => {
  beforeEach(resetMocks)

  it('calls invoke("index_item") in Tauri mode', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined)
    const item = { objectId: 'app_1', name: 'Finder', category: 'app' } as any
    await getInstance().indexItem(item)
    expect(invoke).toHaveBeenCalledWith('index_item', { item })
  })

  it('skips invoke in browser mode', async () => {
    ;(envService as any).isBrowser = true
    await getInstance().indexItem({ objectId: 'app_1', name: 'Finder', category: 'app' } as any)
    expect(invoke).not.toHaveBeenCalled()
  })

  it('swallows errors without throwing', async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error('fail'))
    await expect(getInstance().indexItem({ objectId: 'x', name: 'x', category: 'app' } as any)).resolves.toBeUndefined()
  })
})

// ── batchIndexItems ───────────────────────────────────────────────────────────

describe('batchIndexItems', () => {
  beforeEach(resetMocks)

  it('calls invoke("batch_index_items") with the items', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined)
    const items = [{ objectId: 'app_1', name: 'A', category: 'app' }] as any[]
    await getInstance().batchIndexItems(items)
    expect(invoke).toHaveBeenCalledWith('batch_index_items', { items })
  })

  it('skips invoke when items array is empty', async () => {
    await getInstance().batchIndexItems([])
    expect(invoke).not.toHaveBeenCalled()
  })

  it('skips invoke in browser mode', async () => {
    ;(envService as any).isBrowser = true
    await getInstance().batchIndexItems([{ objectId: 'x', name: 'x', category: 'app' } as any])
    expect(invoke).not.toHaveBeenCalled()
  })
})

// ── deleteItem ────────────────────────────────────────────────────────────────

describe('deleteItem', () => {
  beforeEach(resetMocks)

  it('calls invoke("delete_item") with the objectId', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined)
    await getInstance().deleteItem('app_1')
    expect(invoke).toHaveBeenCalledWith('delete_item', { objectId: 'app_1' })
  })

  it('skips invoke in browser mode', async () => {
    ;(envService as any).isBrowser = true
    await getInstance().deleteItem('app_1')
    expect(invoke).not.toHaveBeenCalled()
  })

  it('swallows errors without throwing', async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error('fail'))
    await expect(getInstance().deleteItem('x')).resolves.toBeUndefined()
  })
})

// ── getIndexedObjectIds ───────────────────────────────────────────────────────

describe('getIndexedObjectIds', () => {
  beforeEach(resetMocks)

  it('returns empty Set in browser mode', async () => {
    ;(envService as any).isBrowser = true
    expect(await getInstance().getIndexedObjectIds()).toEqual(new Set())
  })

  it('returns all IDs when no prefix is given', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(['app_1', 'cmd_2', 'app_3'])
    const result = await getInstance().getIndexedObjectIds()
    expect(result).toEqual(new Set(['app_1', 'cmd_2', 'app_3']))
  })

  it('filters by "app_" prefix', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(['app_1', 'cmd_2', 'app_3'])
    const result = await getInstance().getIndexedObjectIds('app_')
    expect(result).toEqual(new Set(['app_1', 'app_3']))
  })

  it('filters by "cmd_" prefix', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(['app_1', 'cmd_2', 'app_3'])
    const result = await getInstance().getIndexedObjectIds('cmd_')
    expect(result).toEqual(new Set(['cmd_2']))
  })

  it('returns empty Set when invoke throws', async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error('fail'))
    expect(await getInstance().getIndexedObjectIds()).toEqual(new Set())
  })
})

// ── resetIndex ────────────────────────────────────────────────────────────────

describe('resetIndex', () => {
  beforeEach(resetMocks)

  it('calls invoke("reset_search_index")', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined)
    await getInstance().resetIndex()
    expect(invoke).toHaveBeenCalledWith('reset_search_index')
  })

  it('skips invoke in browser mode', async () => {
    ;(envService as any).isBrowser = true
    await getInstance().resetIndex()
    expect(invoke).not.toHaveBeenCalled()
  })

  it('swallows errors without throwing', async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error('fail'))
    await expect(getInstance().resetIndex()).resolves.toBeUndefined()
  })
})
