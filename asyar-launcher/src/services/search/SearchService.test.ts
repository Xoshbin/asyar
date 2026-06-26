import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('../diagnostics/diagnosticsService.svelte', () => ({
  diagnosticsService: { report: vi.fn() },
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

import { SearchService } from './SearchService'
import { invoke } from '@tauri-apps/api/core'
import { diagnosticsService } from '../diagnostics/diagnosticsService.svelte'

function getInstance() {
  return new SearchService()
}

function resetMocks() {
  vi.mocked(invoke).mockClear()
  vi.mocked(diagnosticsService.report).mockClear()
}

// ── performSearch ─────────────────────────────────────────────────────────────

describe('performSearch', () => {
  beforeEach(resetMocks)

  it('delegates to invoke', async () => {
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

  it('reports an error diagnostic when search fails', async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error('backend error'))
    await getInstance().performSearch('x')
    expect(diagnosticsService.report).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'frontend',
        kind: 'search/perform-failed',
        severity: 'error',
      }),
    )
  })

  it('does not leak the raw query into the diagnostic context', async () => {
    // Users may paste secrets into the search bar. The diagnostic
    // envelope persists to logs and surfaces in the DiagnosticBar, so
    // never include the raw query — length is enough for debugging.
    vi.mocked(invoke).mockRejectedValueOnce(new Error('backend error'))
    const secret = 'sk-live-supersecret-do-not-leak'
    await getInstance().performSearch(secret)

    const reported = vi.mocked(diagnosticsService.report).mock.calls[0][0]
    expect(JSON.stringify(reported)).not.toContain(secret)
    expect(reported.context).toEqual(
      expect.objectContaining({ queryLength: String(secret.length) }),
    )
    expect(reported.context).not.toHaveProperty('query')
  })
})

// ── indexItem ─────────────────────────────────────────────────────────────────

describe('indexItem', () => {
  beforeEach(resetMocks)

  it('calls invoke("index_item")', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined)
    const item = { objectId: 'app_1', name: 'Finder', category: 'app' } as any
    await getInstance().indexItem(item)
    expect(invoke).toHaveBeenCalledWith('index_item', { item })
  })

  it('swallows errors without throwing', async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error('fail'))
    await expect(getInstance().indexItem({ objectId: 'x', name: 'x', category: 'app' } as any)).resolves.toBeUndefined()
  })

  it('reports a warning diagnostic when indexing fails', async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error('fail'))
    await getInstance().indexItem({ objectId: 'x', name: 'x', category: 'app' } as any)
    expect(diagnosticsService.report).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'search/index-failed', severity: 'warning' }),
    )
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
})

// ── deleteItem ────────────────────────────────────────────────────────────────

describe('deleteItem', () => {
  beforeEach(resetMocks)

  it('calls invoke("delete_item") with the objectId', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined)
    await getInstance().deleteItem('app_1')
    expect(invoke).toHaveBeenCalledWith('delete_item', { objectId: 'app_1' })
  })

  it('swallows errors without throwing', async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error('fail'))
    await expect(getInstance().deleteItem('x')).resolves.toBeUndefined()
  })
})

// ── getIndexedObjectIds ───────────────────────────────────────────────────────

describe('getIndexedObjectIds', () => {
  beforeEach(resetMocks)

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
    expect(invoke).toHaveBeenCalledWith('reset_search_index', undefined)
  })

  it('swallows errors without throwing', async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error('fail'))
    await expect(getInstance().resetIndex()).resolves.toBeUndefined()
  })
})
