import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

// vi.hoisted ensures this value is available when the mock factory below runs
const mockStorage = vi.hoisted(() => ({ store: {} as Record<string, any> }))

vi.mock('@tauri-apps/plugin-store', () => ({
  LazyStore: class {
    async init() {}
    async get(key: string) { return mockStorage.store[key] ?? null }
    async set(key: string, value: any) { mockStorage.store[key] = value }
  }
}))

import { ClipboardHistoryStoreClass } from './clipboardHistoryStore.svelte'

describe('addHistoryItem — favorite preservation on duplicate', () => {
  let store: ClipboardHistoryStoreClass

  beforeEach(async () => {
    mockStorage.store = {}
    store = new ClipboardHistoryStoreClass()
    await store.init()
  })

  it('preserves favorite:true when the same content is added again', async () => {
    const now = Date.now()
    const original = { id: '1', type: 'text' as any, content: 'hello', createdAt: now - 1000, favorite: true }
    await store.addHistoryItem(original)

    const duplicate = { id: '2', type: 'text' as any, content: 'hello', createdAt: now, favorite: false }
    await store.addHistoryItem(duplicate)

    const items = await store.getHistoryItems()
    expect(items).toHaveLength(1)
    expect(items[0].favorite).toBe(true)
  })

  it('does not promote favorite when original was not favorited', async () => {
    const now = Date.now()
    const original = { id: '1', type: 'text' as any, content: 'hello', createdAt: now - 1000, favorite: false }
    await store.addHistoryItem(original)

    const duplicate = { id: '2', type: 'text' as any, content: 'hello', createdAt: now, favorite: false }
    await store.addHistoryItem(duplicate)

    const items = await store.getHistoryItems()
    expect(items).toHaveLength(1)
    expect(items[0].favorite).toBe(false)
  })
})
