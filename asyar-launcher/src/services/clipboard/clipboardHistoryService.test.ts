import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({
  readText: vi.fn(),
  readImage: vi.fn(),
  writeText: vi.fn(),
  writeHtml: vi.fn(),
  writeImage: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

vi.mock('./stores/clipboardHistoryStore', () => ({
  initClipboardStore: vi.fn(),
  addHistoryItem: vi.fn(),
  getHistoryItems: vi.fn().mockResolvedValue([]),
  toggleFavorite: vi.fn(),
  deleteHistoryItem: vi.fn(),
  clearHistory: vi.fn(),
}))

vi.mock('uuid', () => ({ v4: vi.fn(() => 'test-uuid') }))
vi.mock('../../utils/isHtml', () => ({ isHtml: vi.fn(() => false) }))

import { ClipboardHistoryService } from './clipboardHistoryService'
import { ClipboardItemType, type ClipboardHistoryItem } from 'asyar-sdk'

function getInstance(): ClipboardHistoryService {
  ;(ClipboardHistoryService as any).instance = undefined
  return ClipboardHistoryService.getInstance() as ClipboardHistoryService
}

function makeItem(
  type: ClipboardItemType,
  content: string,
  overrides: Partial<ClipboardHistoryItem> = {}
): ClipboardHistoryItem {
  return { id: 'id', type, content, preview: '', createdAt: Date.now(), favorite: false, ...overrides }
}

// ── normalizeImageData ────────────────────────────────────────────────────────

describe('normalizeImageData', () => {
  it('removes the extra space after the base64 header', () => {
    const svc = getInstance()
    const input = 'data:image/png;base64, abc123'
    expect(svc.normalizeImageData(input)).toBe('data:image/png;base64,abc123')
  })

  it('prepends the data URI prefix when missing', () => {
    const svc = getInstance()
    expect(svc.normalizeImageData('abc123')).toBe('data:image/png;base64,abc123')
  })

  it('leaves a well-formed data URI unchanged', () => {
    const svc = getInstance()
    const input = 'data:image/png;base64,abc123'
    expect(svc.normalizeImageData(input)).toBe(input)
  })
})

// ── isValidImageData ──────────────────────────────────────────────────────────

describe('isValidImageData', () => {
  it('returns false for empty string', () => {
    expect(getInstance().isValidImageData('')).toBe(false)
  })

  it('returns false for placeholder data containing AAAAAAAA', () => {
    expect(getInstance().isValidImageData('data:image/png;base64,AAAAAAAA')).toBe(false)
  })

  it('returns true for real-looking base64 data', () => {
    expect(getInstance().isValidImageData('data:image/png;base64,iVBORw0KGgo=')).toBe(true)
  })
})

// ── formatClipboardItem ───────────────────────────────────────────────────────

describe('formatClipboardItem', () => {
  it('returns a human-readable date string for image items', () => {
    const svc = getInstance()
    const item = makeItem(ClipboardItemType.Image, 'data:image/png;base64,xyz')
    expect(svc.formatClipboardItem(item)).toMatch(/^Image captured on /)
  })

  it('returns empty string for text items with no content', () => {
    const svc = getInstance()
    const item = makeItem(ClipboardItemType.Text, '')
    expect(svc.formatClipboardItem(item)).toBe('')
  })

  it('returns the content for short text items', () => {
    const svc = getInstance()
    const item = makeItem(ClipboardItemType.Text, 'hello')
    expect(svc.formatClipboardItem(item)).toBe('hello')
  })

  it('truncates text items longer than 100 characters', () => {
    const svc = getInstance()
    const long = 'a'.repeat(120)
    const result = svc.formatClipboardItem(makeItem(ClipboardItemType.Text, long))
    expect(result).toHaveLength(103) // 100 + '...'
    expect(result.endsWith('...')).toBe(true)
  })
})

// ── writeToClipboard ──────────────────────────────────────────────────────────

describe('writeToClipboard', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('throws for items with empty content', async () => {
    const svc = getInstance()
    await expect(
      svc.writeToClipboard(makeItem(ClipboardItemType.Text, ''))
    ).rejects.toThrow('Cannot paste item with empty content')
  })

  it('calls writeText for Text items', async () => {
    const { writeText } = await import('@tauri-apps/plugin-clipboard-manager')
    const svc = getInstance()
    await svc.writeToClipboard(makeItem(ClipboardItemType.Text, 'hello'))
    expect(writeText).toHaveBeenCalledWith('hello')
  })

  it('throws for unsupported item types', async () => {
    const svc = getInstance()
    const bad = makeItem('unsupported' as ClipboardItemType, 'x')
    await expect(svc.writeToClipboard(bad)).rejects.toThrow('Unsupported clipboard item type')
  })
})

// ── getRecentItems ────────────────────────────────────────────────────────────

describe('getRecentItems', () => {
  it('returns at most the requested limit', async () => {
    const { getHistoryItems } = await import('./stores/clipboardHistoryStore')
    const items = Array.from({ length: 50 }, (_, i) =>
      makeItem(ClipboardItemType.Text, `item ${i}`)
    )
    vi.mocked(getHistoryItems).mockResolvedValueOnce(items)
    const result = await getInstance().getRecentItems(10)
    expect(result).toHaveLength(10)
  })

  it('filters out items without id or type', async () => {
    const { getHistoryItems } = await import('./stores/clipboardHistoryStore')
    vi.mocked(getHistoryItems).mockResolvedValueOnce([
      makeItem(ClipboardItemType.Text, 'good'),
      { ...makeItem(ClipboardItemType.Text, 'no-id'), id: '' },
      { ...makeItem(ClipboardItemType.Text, 'no-type'), type: '' as ClipboardItemType },
    ])
    const result = await getInstance().getRecentItems(30)
    expect(result).toHaveLength(1)
    expect(result[0].content).toBe('good')
  })
})
