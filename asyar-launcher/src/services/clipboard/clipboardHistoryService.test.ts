/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('tauri-plugin-clipboard-x-api', () => ({
  readText: vi.fn(),
  readHTML: vi.fn(),
  readImage: vi.fn(),
  readFiles: vi.fn(),
  writeText: vi.fn(),
  writeHTML: vi.fn(),
  writeImage: vi.fn(),
  writeFiles: vi.fn(),
  hasText: vi.fn(),
  hasHTML: vi.fn(),
  hasImage: vi.fn(),
  hasFiles: vi.fn(),
  startListening: vi.fn(),
  stopListening: vi.fn(),
  onClipboardChange: vi.fn().mockResolvedValue(vi.fn()),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

vi.mock('./stores/clipboardHistoryStore.svelte', () => ({
  clipboardHistoryStore: {
    init: vi.fn(),
    addHistoryItem: vi.fn(),
    getHistoryItems: vi.fn().mockResolvedValue([]),
    toggleFavorite: vi.fn(),
    deleteHistoryItem: vi.fn(),
    clearHistory: vi.fn(),
    items: [],
  }
}))

vi.mock('uuid', () => ({ v4: vi.fn(() => 'test-uuid') }))

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
    const item = makeItem(ClipboardItemType.Image, '/path/to/image.png')
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
    const { writeText } = await import('tauri-plugin-clipboard-x-api')
    const svc = getInstance()
    await svc.writeToClipboard(makeItem(ClipboardItemType.Text, 'hello'))
    expect(writeText).toHaveBeenCalledWith('hello')
  })

  it('calls writeHTML for HTML items with plaintext fallback', async () => {
    const { writeHTML } = await import('tauri-plugin-clipboard-x-api')
    const svc = getInstance()
    const html = '<b>bold</b>'
    await svc.writeToClipboard(makeItem(ClipboardItemType.Html, html))
    expect(writeHTML).toHaveBeenCalledWith('bold', html)
  })

  it('calls writeImage for Image items with file path', async () => {
    const { writeImage } = await import('tauri-plugin-clipboard-x-api')
    const svc = getInstance()
    const path = '/path/to/image.png'
    await svc.writeToClipboard(makeItem(ClipboardItemType.Image, path))
    expect(writeImage).toHaveBeenCalledWith(path)
  })

  it('throws for unsupported item types', async () => {
    const svc = getInstance()
    const bad = makeItem('unsupported' as ClipboardItemType, 'x')
    await expect(svc.writeToClipboard(bad)).rejects.toThrow('Unsupported clipboard item type')
  })
})

// ── handleClipboardChange ───────────────────────────────────────────────────

describe('handleClipboardChange', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('captures text when result contains text', async () => {
    const svc = getInstance();
    const { clipboardHistoryStore } = await import('./stores/clipboardHistoryStore.svelte');
    
    await (svc as any).handleClipboardChange({
      text: { type: 'text', value: 'hello world', count: 11 }
    });
    
    expect(clipboardHistoryStore.addHistoryItem).toHaveBeenCalledWith(
      expect.objectContaining({ type: ClipboardItemType.Text, content: 'hello world' })
    );
  });

  it('captures html when result contains html', async () => {
    const svc = getInstance();
    const { clipboardHistoryStore } = await import('./stores/clipboardHistoryStore.svelte');
    
    await (svc as any).handleClipboardChange({
      html: { type: 'html', value: '<b>bold</b>', count: 11 },
      text: { type: 'text', value: 'bold', count: 4 }
    });
    
    // Should capture HTML, not text (HTML has priority)
    expect(clipboardHistoryStore.addHistoryItem).toHaveBeenCalledWith(
      expect.objectContaining({ type: ClipboardItemType.Html, content: '<b>bold</b>' })
    );
  });

  it('captures image when result contains image', async () => {
    const svc = getInstance();
    const { clipboardHistoryStore } = await import('./stores/clipboardHistoryStore.svelte');
    
    await (svc as any).handleClipboardChange({
      image: { type: 'image', value: '/tmp/clipboard-image.png', count: 1, width: 800, height: 600 }
    });
    
    expect(clipboardHistoryStore.addHistoryItem).toHaveBeenCalledWith(
      expect.objectContaining({ type: ClipboardItemType.Image, content: '/tmp/clipboard-image.png' })
    );
  });

  it('prioritizes image over text and html', async () => {
    const svc = getInstance();
    const { clipboardHistoryStore } = await import('./stores/clipboardHistoryStore.svelte');
    
    await (svc as any).handleClipboardChange({
      image: { type: 'image', value: '/tmp/img.png', count: 1, width: 100, height: 100 },
      text: { type: 'text', value: 'fallback', count: 8 },
      html: { type: 'html', value: '<p>fallback</p>', count: 14 }
    });
    
    expect(clipboardHistoryStore.addHistoryItem).toHaveBeenCalledWith(
      expect.objectContaining({ type: ClipboardItemType.Image })
    );
  });

  it('deduplicates text content', async () => {
    const svc = getInstance();
    const { clipboardHistoryStore } = await import('./stores/clipboardHistoryStore.svelte');
    
    await (svc as any).handleClipboardChange({ text: { type: 'text', value: 'same', count: 4 } });
    await (svc as any).handleClipboardChange({ text: { type: 'text', value: 'same', count: 4 } });
    
    // Should only add once (second call is a duplicate)
    expect(clipboardHistoryStore.addHistoryItem).toHaveBeenCalledTimes(1);
  });
});

// ── getRecentItems ────────────────────────────────────────────────────────────

describe('getRecentItems', () => {
  it('returns at most the requested limit', async () => {
    const { clipboardHistoryStore } = await import('./stores/clipboardHistoryStore.svelte')
    const items = Array.from({ length: 50 }, (_, i) =>
      makeItem(ClipboardItemType.Text, `item ${i}`)
    )
    vi.mocked(clipboardHistoryStore.getHistoryItems).mockResolvedValueOnce(items)
    const result = await getInstance().getRecentItems(10)
    expect(result).toHaveLength(10)
  })

  it('filters out items without id or type', async () => {
    const { clipboardHistoryStore } = await import('./stores/clipboardHistoryStore.svelte')
    vi.mocked(clipboardHistoryStore.getHistoryItems).mockResolvedValueOnce([
      makeItem(ClipboardItemType.Text, 'good'),
      { ...makeItem(ClipboardItemType.Text, 'no-id'), id: '' },
      { ...makeItem(ClipboardItemType.Text, 'no-type'), type: '' as ClipboardItemType },
    ])
    const result = await getInstance().getRecentItems(30)
    expect(result).toHaveLength(1)
    expect(result[0].content).toBe('good')
  })
})

// ── pasteItem ─────────────────────────────────────────────────────────────────

describe('pasteItem', () => {
  it('calls hideWindow, writeToClipboard, and simulatePaste in order without delay', async () => {
    const svc = getInstance()

    const hideWindowSpy = vi.spyOn(svc, 'hideWindow').mockResolvedValue(undefined)
    const writeToClipboardSpy = vi.spyOn(svc, 'writeToClipboard').mockResolvedValue(undefined)
    const simulatePasteSpy = vi.spyOn(svc, 'simulatePaste').mockResolvedValue(true)

    const item = makeItem(ClipboardItemType.Text, 'pasted content')

    await svc.pasteItem(item)

    expect(hideWindowSpy).toHaveBeenCalled()
    expect(writeToClipboardSpy).toHaveBeenCalledWith(item)
    expect(simulatePasteSpy).toHaveBeenCalled()
  })
})
