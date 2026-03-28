import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

vi.mock('../envService', () => ({
  envService: { isTauri: false, isBrowser: true },
}))

import { statusBarService, type StatusBarItem } from './statusBarService.svelte'

function item(extensionId: string, id: string, text = 'label'): StatusBarItem {
  return { extensionId, id, text }
}

beforeEach(() => {
  statusBarService.items = []
})

// ── registerItem ──────────────────────────────────────────────────────────────

describe('registerItem', () => {
  it('adds a new item to the store', () => {
    statusBarService.registerItem(item('ext-a', 'clock'))
    expect(statusBarService.items).toHaveLength(1)
    expect(statusBarService.items[0].id).toBe('clock')
  })

  it('replaces an existing item with the same extensionId + id', () => {
    statusBarService.registerItem(item('ext-a', 'clock', 'old'))
    statusBarService.registerItem(item('ext-a', 'clock', 'new'))
    const items = statusBarService.items
    expect(items).toHaveLength(1)
    expect(items[0].text).toBe('new')
  })

  it('keeps items with the same id but different extensionId', () => {
    statusBarService.registerItem(item('ext-a', 'status'))
    statusBarService.registerItem(item('ext-b', 'status'))
    expect(statusBarService.items).toHaveLength(2)
  })

  it('appends after existing items', () => {
    statusBarService.registerItem(item('ext-a', 'first'))
    statusBarService.registerItem(item('ext-a', 'second'))
    const ids = statusBarService.items.map((i: any) => i.id)
    expect(ids).toEqual(['first', 'second'])
  })
})

// ── updateItem ────────────────────────────────────────────────────────────────

describe('updateItem', () => {
  it('updates the text of a matching item', () => {
    statusBarService.registerItem(item('ext-a', 'badge', 'old'))
    statusBarService.updateItem('ext-a', 'badge', { text: 'new' })
    expect(statusBarService.items[0].text).toBe('new')
  })

  it('updates the icon of a matching item', () => {
    statusBarService.registerItem(item('ext-a', 'badge'))
    statusBarService.updateItem('ext-a', 'badge', { icon: '🔔' })
    expect(statusBarService.items[0].icon).toBe('🔔')
  })

  it('does not mutate other items', () => {
    statusBarService.registerItem(item('ext-a', 'x', 'keep'))
    statusBarService.registerItem(item('ext-a', 'y', 'old'))
    statusBarService.updateItem('ext-a', 'y', { text: 'new' })
    expect(statusBarService.items.find((i: any) => i.id === 'x')?.text).toBe('keep')
  })

  it('is a no-op for a non-existent item', () => {
    statusBarService.registerItem(item('ext-a', 'real'))
    statusBarService.updateItem('ext-a', 'ghost', { text: 'x' })
    expect(statusBarService.items).toHaveLength(1)
  })
})

// ── unregisterItem ────────────────────────────────────────────────────────────

describe('unregisterItem', () => {
  it('removes the matching item', () => {
    statusBarService.registerItem(item('ext-a', 'to-remove'))
    statusBarService.unregisterItem('ext-a', 'to-remove')
    expect(statusBarService.items).toHaveLength(0)
  })

  it('only removes the exact extensionId + id match', () => {
    statusBarService.registerItem(item('ext-a', 'shared-id'))
    statusBarService.registerItem(item('ext-b', 'shared-id'))
    statusBarService.unregisterItem('ext-a', 'shared-id')
    const remaining = statusBarService.items
    expect(remaining).toHaveLength(1)
    expect(remaining[0].extensionId).toBe('ext-b')
  })

  it('is a no-op when the item does not exist', () => {
    statusBarService.registerItem(item('ext-a', 'keep'))
    statusBarService.unregisterItem('ext-a', 'ghost')
    expect(statusBarService.items).toHaveLength(1)
  })
})

// ── clearItemsForExtension ────────────────────────────────────────────────────

describe('clearItemsForExtension', () => {
  it('removes all items for the given extension', () => {
    statusBarService.registerItem(item('ext-a', 'a1'))
    statusBarService.registerItem(item('ext-a', 'a2'))
    statusBarService.registerItem(item('ext-b', 'b1'))
    statusBarService.clearItemsForExtension('ext-a')
    const remaining = statusBarService.items
    expect(remaining).toHaveLength(1)
    expect(remaining[0].extensionId).toBe('ext-b')
  })

  it('is a no-op when the extension has no items', () => {
    statusBarService.registerItem(item('ext-b', 'keep'))
    statusBarService.clearItemsForExtension('ext-a')
    expect(statusBarService.items).toHaveLength(1)
  })
})
