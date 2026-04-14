import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }))
vi.mock('../log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

// appUpdateStore uses a class with $state fields — the class-based placement is
// supported by the Svelte 5 compiler in the Vitest transform pipeline.

import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

describe('appUpdateStore', () => {
  // Lazy import to avoid crashing the test file at collection time
  let appUpdateState: any
  let initAppUpdateStore: any
  let destroyAppUpdateStore: any

  beforeEach(async () => {
    vi.clearAllMocks()
    ;({ appUpdateState, initAppUpdateStore, destroyAppUpdateStore } = await import('./appUpdateStore.svelte'))
    destroyAppUpdateStore()  // This now also resets state
    vi.mocked(listen).mockResolvedValue(vi.fn())
  })

  it('stays idle when no pending update from Rust', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(null)
    await initAppUpdateStore()
    expect(appUpdateState.phase).toBe('idle')
    expect(appUpdateState.pendingVersion).toBeNull()
  })

  it('sets phase to ready when pending update exists on init', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ version: '2.0.0' })
    await initAppUpdateStore()
    expect(appUpdateState.phase).toBe('ready')
    expect(appUpdateState.pendingVersion).toBe('2.0.0')
  })

  it('is idempotent — second init call is a no-op', async () => {
    vi.mocked(invoke).mockResolvedValue(null)
    await initAppUpdateStore()
    await initAppUpdateStore()
    expect(invoke).toHaveBeenCalledOnce()
  })
})
