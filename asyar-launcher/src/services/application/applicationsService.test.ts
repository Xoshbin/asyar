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

function resetService() {
  ;(applicationService as any).initialized = false
  vi.mocked(invoke).mockClear()
}

// ── init ──────────────────────────────────────────────────────────────────────

describe('init', () => {
  beforeEach(resetService)

  it('calls sync_application_index and sets initialized to true on success', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ added: 5, removed: 2, total: 10 })

    await applicationService.init()

    expect(invoke).toHaveBeenCalledWith('sync_application_index')
    expect((applicationService as any).initialized).toBe(true)
  })

  it('does not call sync_application_index again if already initialized', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ added: 0, removed: 0, total: 10 })
    await applicationService.init()

    vi.mocked(invoke).mockClear()
    await applicationService.init()

    expect(invoke).not.toHaveBeenCalledWith('sync_application_index')
  })

  it('does not set initialized to true when sync throws', async () => {
    // We need to make sure the error actually propagates or is handled
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
    const app = { 
      objectId: 'app_finder', 
      name: 'Finder', 
      path: '/Applications/Finder.app', 
      type: 'application' as const, 
      score: 1 
    }

    await applicationService.open(app)

    expect(invoke).toHaveBeenCalledWith('open_application_path', { path: '/Applications/Finder.app' })
  })

  it('hides the launcher window before opening', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined)
    const app = { 
      objectId: 'app_finder', 
      name: 'Finder', 
      path: '/Applications/Finder.app', 
      type: 'application' as const, 
      score: 1 
    }

    await applicationService.open(app)

    const calls = vi.mocked(invoke).mock.calls
    const hideCall = calls.find(c => c[0] === 'hide')
    const openCall = calls.find(c => c[0] === 'open_application_path')
    expect(hideCall).toBeDefined()
    expect(openCall).toBeDefined()
  })

  it('does not call open_application_path when path is missing', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined)
    const app = { 
      objectId: 'app_x', 
      name: 'Unknown', 
      path: undefined as any, 
      type: 'application' as const, 
      score: 1 
    }

    await applicationService.open(app)

    expect(invoke).not.toHaveBeenCalledWith('open_application_path', expect.anything())
  })

  it('records usage when a valid objectId is present', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined)
    const app = { 
      objectId: 'app_finder', 
      name: 'Finder', 
      path: '/Applications/Finder.app', 
      type: 'application' as const, 
      score: 1 
    }

    await applicationService.open(app)

    expect(invoke).toHaveBeenCalledWith('record_item_usage', { objectId: 'app_finder' })
  })

  it('does not record usage when objectId is the fallback missing ID', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined)
    const app = { 
      objectId: 'missing_id_abc', 
      name: 'Finder', 
      path: '/Applications/Finder.app', 
      type: 'application' as const, 
      score: 1 
    }

    await applicationService.open(app)

    expect(invoke).not.toHaveBeenCalledWith('record_item_usage', expect.anything())
  })

  it('does not record usage when objectId is absent', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined)
    const app = { 
      objectId: '', 
      name: 'Finder', 
      path: '/Applications/Finder.app', 
      type: 'application' as const, 
      score: 1 
    }

    await applicationService.open(app)

    expect(invoke).not.toHaveBeenCalledWith('record_item_usage', expect.anything())
  })
})
