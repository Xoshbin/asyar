import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

vi.mock('../search/SearchService', () => ({
  searchService: {
    getIndexedObjectIds: vi.fn().mockResolvedValue(new Set()),
    batchIndexItems: vi.fn().mockResolvedValue(undefined),
    deleteItem: vi.fn().mockResolvedValue(undefined),
    saveIndex: vi.fn().mockResolvedValue(undefined),
  },
}))

vi.mock('../search/topItemsCache', () => ({
  invalidateTopItemsCache: vi.fn(),
}))

import { applicationService } from './applicationsService'
import { invoke } from '@tauri-apps/api/core'
import { searchService } from '../search/SearchService'

function makeApp(id: string, name: string, path = `/Applications/${name}.app`) {
  return { id, name, path, icon: '' }
}

function resetService() {
  ;(applicationService as any).initialized = false
  ;(applicationService as any).allApps = []
  vi.mocked(invoke).mockClear()
  vi.mocked(searchService.getIndexedObjectIds).mockClear()
  vi.mocked(searchService.batchIndexItems).mockClear()
  vi.mocked(searchService.deleteItem).mockClear()
}

// ── syncApplicationIndex (via init) ───────────────────────────────────────────

describe('syncApplicationIndex', () => {
  beforeEach(resetService)

  it('indexes new apps that are not yet in the search index', async () => {
    const apps = [makeApp('app_finder', 'Finder'), makeApp('app_safari', 'Safari')]
    vi.mocked(invoke).mockResolvedValueOnce(apps) // list_applications
    vi.mocked(searchService.getIndexedObjectIds).mockResolvedValueOnce(new Set())

    await (applicationService as any).syncApplicationIndex()

    expect(searchService.batchIndexItems).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'app_finder', name: 'Finder', category: 'application' }),
      expect.objectContaining({ id: 'app_safari', name: 'Safari', category: 'application' }),
    ])
  })

  it('does not re-index apps that are already in the search index', async () => {
    const apps = [makeApp('app_finder', 'Finder')]
    vi.mocked(invoke).mockResolvedValueOnce(apps)
    vi.mocked(searchService.getIndexedObjectIds).mockResolvedValueOnce(new Set(['app_finder']))

    await (applicationService as any).syncApplicationIndex()

    expect(searchService.batchIndexItems).toHaveBeenCalledWith([])
  })

  it('deletes stale indexed IDs that are no longer installed', async () => {
    vi.mocked(invoke).mockResolvedValueOnce([]) // no apps installed
    vi.mocked(searchService.getIndexedObjectIds).mockResolvedValueOnce(
      new Set(['app_old1', 'app_old2'])
    )

    await (applicationService as any).syncApplicationIndex()

    expect(searchService.deleteItem).toHaveBeenCalledWith('app_old1')
    expect(searchService.deleteItem).toHaveBeenCalledWith('app_old2')
  })

  it('handles a mix: some new, some stale, some unchanged', async () => {
    const apps = [makeApp('app_new', 'NewApp'), makeApp('app_keep', 'KeepApp')]
    vi.mocked(invoke).mockResolvedValueOnce(apps)
    vi.mocked(searchService.getIndexedObjectIds).mockResolvedValueOnce(
      new Set(['app_keep', 'app_stale'])
    )

    await (applicationService as any).syncApplicationIndex()

    expect(searchService.batchIndexItems).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'app_new' }),
    ])
    expect(searchService.deleteItem).toHaveBeenCalledWith('app_stale')
    expect(searchService.deleteItem).not.toHaveBeenCalledWith('app_keep')
  })

  it('stores fetched apps in allApps', async () => {
    const apps = [makeApp('app_finder', 'Finder')]
    vi.mocked(invoke).mockResolvedValueOnce(apps)
    vi.mocked(searchService.getIndexedObjectIds).mockResolvedValueOnce(new Set())

    await (applicationService as any).syncApplicationIndex()

    expect((applicationService as any).allApps).toEqual(apps)
  })

  it('throws when list_applications fails', async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error('backend error'))

    await expect((applicationService as any).syncApplicationIndex()).rejects.toThrow('backend error')
  })
})

// ── init ──────────────────────────────────────────────────────────────────────

describe('init', () => {
  beforeEach(resetService)

  it('sets initialized to true on success', async () => {
    vi.mocked(invoke).mockResolvedValueOnce([])
    vi.mocked(searchService.getIndexedObjectIds).mockResolvedValueOnce(new Set())

    await applicationService.init()

    expect((applicationService as any).initialized).toBe(true)
  })

  it('does not call syncApplicationIndex again if already initialized', async () => {
    vi.mocked(invoke).mockResolvedValueOnce([])
    vi.mocked(searchService.getIndexedObjectIds).mockResolvedValueOnce(new Set())
    await applicationService.init()

    vi.mocked(invoke).mockClear()
    await applicationService.init()

    expect(invoke).not.toHaveBeenCalled()
  })

  it('does not set initialized to true when sync throws', async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error('fail'))

    await applicationService.init()

    expect((applicationService as any).initialized).toBe(false)
  })
})

// ── open ──────────────────────────────────────────────────────────────────────

describe('open', () => {
  beforeEach(resetService)

  it('opens the application at its path', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined)
    const app = { objectId: 'app_finder', name: 'Finder', path: '/Applications/Finder.app', type: 'application' as const, score: 1 }

    await applicationService.open(app)

    expect(invoke).toHaveBeenCalledWith('open_application_path', { path: '/Applications/Finder.app' })
  })

  it('hides the launcher window before opening', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined)
    const app = { objectId: 'app_finder', name: 'Finder', path: '/Applications/Finder.app', type: 'application' as const, score: 1 }

    await applicationService.open(app)

    const calls = vi.mocked(invoke).mock.calls
    const hideCall = calls.find(c => c[0] === 'hide')
    const openCall = calls.find(c => c[0] === 'open_application_path')
    expect(hideCall).toBeDefined()
    expect(openCall).toBeDefined()
  })

  it('does not call open_application_path when path is missing', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined)
    const app = { objectId: 'app_x', name: 'Unknown', path: undefined as any, type: 'application' as const, score: 1 }

    await applicationService.open(app)

    expect(invoke).not.toHaveBeenCalledWith('open_application_path', expect.anything())
  })

  it('records usage when a valid objectId is present', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined)
    const app = { objectId: 'app_finder', name: 'Finder', path: '/Applications/Finder.app', type: 'application' as const, score: 1 }

    await applicationService.open(app)

    expect(invoke).toHaveBeenCalledWith('record_item_usage', { objectId: 'app_finder' })
  })

  it('does not record usage when objectId is the fallback missing ID', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined)
    const app = { objectId: 'missing_id_abc', name: 'Finder', path: '/Applications/Finder.app', type: 'application' as const, score: 1 }

    await applicationService.open(app)

    expect(invoke).not.toHaveBeenCalledWith('record_item_usage', expect.anything())
  })

  it('does not record usage when objectId is absent', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined)
    const app = { objectId: '', name: 'Finder', path: '/Applications/Finder.app', type: 'application' as const, score: 1 }

    await applicationService.open(app)

    expect(invoke).not.toHaveBeenCalledWith('record_item_usage', expect.anything())
  })
})
