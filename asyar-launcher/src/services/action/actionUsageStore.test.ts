import { vi, describe, it, expect, beforeEach } from 'vitest'

// Mock localStorage before importing
const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: vi.fn((k: string) => store[k] ?? null),
    setItem: vi.fn((k: string, v: string) => { store[k] = v }),
    clear: () => { store = {} },
  }
})()

vi.stubGlobal('localStorage', localStorageMock)

import { ActionUsageStore } from './actionUsageStore'

beforeEach(() => {
  localStorageMock.clear()
  vi.mocked(localStorageMock.getItem).mockClear()
  vi.mocked(localStorageMock.setItem).mockClear()
})

describe('ActionUsageStore', () => {
  it('returns 0 for an action never used', () => {
    const store = new ActionUsageStore()
    expect(store.getCount('unknown')).toBe(0)
  })

  it('increments the count on record()', () => {
    const store = new ActionUsageStore()
    store.record('paste')
    expect(store.getCount('paste')).toBe(1)
    store.record('paste')
    expect(store.getCount('paste')).toBe(2)
  })

  it('persists counts to localStorage on record()', () => {
    const store = new ActionUsageStore()
    store.record('copy')
    expect(localStorageMock.setItem).toHaveBeenCalled()
  })

  it('loads existing counts from localStorage on construction', () => {
    localStorageMock.getItem.mockReturnValueOnce(JSON.stringify({ 'copy': 5 }))
    const store = new ActionUsageStore()
    expect(store.getCount('copy')).toBe(5)
  })

  it('handles corrupt localStorage data gracefully (returns 0)', () => {
    localStorageMock.getItem.mockReturnValueOnce('not-valid-json{{')
    const store = new ActionUsageStore()
    expect(store.getCount('anything')).toBe(0)
  })

  it('sortByUsage returns actions sorted descending by count within stable order', () => {
    const store = new ActionUsageStore()
    store.record('b')
    store.record('b')
    store.record('c')
    const actions = [{ id: 'a' }, { id: 'b' }, { id: 'c' }] as any[]
    const sorted = store.sortByUsage(actions)
    expect(sorted.map(a => a.id)).toEqual(['b', 'c', 'a'])
  })

  it('sortByUsage treats ties as stable (preserves original order)', () => {
    const store = new ActionUsageStore()
    const actions = [{ id: 'x' }, { id: 'y' }] as any[]
    const sorted = store.sortByUsage(actions)
    expect(sorted.map(a => a.id)).toEqual(['x', 'y'])
  })
})
