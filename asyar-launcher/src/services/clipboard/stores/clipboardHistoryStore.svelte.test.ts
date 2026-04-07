import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

vi.mock('../../envService', () => ({
  envService: { isTauri: true }
}))

// In-memory storage backing the mock invoke calls
const mockDb = vi.hoisted(() => ({
  items: [] as any[],
}))

vi.mock('../../../lib/ipc/commands', () => ({
  clipboardAddItem: vi.fn(async (item: any) => {
    mockDb.items = mockDb.items.filter(i => i.id !== item.id)
    mockDb.items.unshift(item)
  }),
  clipboardGetAll: vi.fn(async () => [...mockDb.items]),
  clipboardToggleFavorite: vi.fn(async (id: string) => {
    const item = mockDb.items.find(i => i.id === id)
    if (item) item.favorite = !item.favorite
    return item?.favorite ?? false
  }),
  clipboardDeleteItem: vi.fn(async (id: string) => {
    mockDb.items = mockDb.items.filter(i => i.id !== id)
  }),
  clipboardClearNonFavorites: vi.fn(async () => {
    mockDb.items = mockDb.items.filter(i => i.favorite)
  }),
  clipboardFindDuplicate: vi.fn(async (itemType: string, content: string | null, id: string) => {
    if (itemType === 'image') {
      return mockDb.items.find(i => i.type === itemType && i.id === id) ?? null
    }
    if (content) {
      return mockDb.items.find(i => i.type === itemType && i.content === content) ?? null
    }
    return null
  }),
  clipboardCleanup: vi.fn(async () => {}),
}))

import { ClipboardHistoryStoreClass } from './clipboardHistoryStore.svelte'

describe('clipboardHistoryStore — Rust-backed', () => {
  let store: ClipboardHistoryStoreClass

  beforeEach(async () => {
    mockDb.items = []
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

  it('toggles favorite status', async () => {
    await store.addHistoryItem({ id: '1', type: 'text' as any, content: 'hello', createdAt: Date.now(), favorite: false })

    await store.toggleFavorite('1')
    expect(store.items[0].favorite).toBe(true)

    await store.toggleFavorite('1')
    expect(store.items[0].favorite).toBe(false)
  })

  it('deletes an item', async () => {
    await store.addHistoryItem({ id: '1', type: 'text' as any, content: 'a', createdAt: Date.now(), favorite: false })
    await store.addHistoryItem({ id: '2', type: 'text' as any, content: 'b', createdAt: Date.now() + 1, favorite: false })

    await store.deleteHistoryItem('1')
    expect(store.items).toHaveLength(1)
    expect(store.items[0].id).toBe('2')
  })

  it('clears non-favorites only', async () => {
    await store.addHistoryItem({ id: '1', type: 'text' as any, content: 'a', createdAt: Date.now(), favorite: false })
    await store.addHistoryItem({ id: '2', type: 'text' as any, content: 'b', createdAt: Date.now() + 1, favorite: true })

    await store.clearHistory()
    expect(store.items).toHaveLength(1)
    expect(store.items[0].id).toBe('2')
  })

  it('getHistoryItems returns a plain array that can be structuredCloned', async () => {
    const now = Date.now()
    await store.addHistoryItem({ id: '1', type: 'text' as any, content: 'hello', createdAt: now, favorite: false })

    const items = await store.getHistoryItems()

    // Must not throw — Svelte 5 $state Proxies fail structuredClone
    expect(() => structuredClone(items)).not.toThrow()
    expect(items).toHaveLength(1)
    expect(items[0].content).toBe('hello')
  })
})
