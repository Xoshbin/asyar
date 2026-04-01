import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock dependencies BEFORE importing the module under test
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn()
}))

vi.mock('../../services/log/logService', () => ({
  logService: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }
}))

import { ClipboardViewStateClass } from './state.svelte'

describe('ClipboardViewStateClass paste action proxy issue', () => {
    let state: ClipboardViewStateClass;
    let mockClipboardService: any;
    let mockLogService: any;

    beforeEach(() => {
        state = new ClipboardViewStateClass();
        mockClipboardService = {
            pasteItem: vi.fn().mockResolvedValue(true),
            hideWindow: vi.fn(),
            getRecentItems: vi.fn().mockResolvedValue([]),
            deleteItem: vi.fn().mockResolvedValue(true),
        };
        mockLogService = {
            error: vi.fn(),
            debug: vi.fn(),
            warn: vi.fn(),
        };
        
        const context = {
            getService: (name: string) => {
                if (name === "ClipboardHistoryService") return mockClipboardService;
                if (name === "LogService") return mockLogService;
                return null;
            }
        };
        state.initializeServices(context as any);
    });

    it('should paste item without Proxy wrapper (fails if Proxy passed)', async () => {
        const item = { id: '1', content: 'test content' };
        
        // Manual proxy to simulate Svelte 5 reactive state behavior in Vitest node environment
        // since $state doesn't automatically wrap items in this test setup
        const reactiveProxy = new Proxy(item, {});
        
        await state.handleItemAction(reactiveProxy as any, 'paste');

        expect(mockClipboardService.pasteItem).toHaveBeenCalled();
        const arg = mockClipboardService.pasteItem.mock.calls[0][0];

        // This expectation will FAIL (RED) if we pass the proxy directly because 
        // structuredClone(proxy) throws.
        // This simulates the actual bug where SDK fails to clone it for postMessage.
        expect(() => structuredClone(arg)).not.toThrow();
    });

    it('should NOT call hideWindow separately after pasteItem', async () => {
        const item = { id: '1', content: 'test content' } as any;
        
        await state.handleItemAction(item, 'paste');

        expect(mockClipboardService.pasteItem).toHaveBeenCalled();
        // This will FAIL (RED) because handleItemAction currently calls hideWindow() 
        // after awaiting pasteItem()
        expect(mockClipboardService.hideWindow).not.toHaveBeenCalled();
    });
});

describe('setItems auto-selection', () => {
    let state: ClipboardViewStateClass;

    beforeEach(() => {
        state = new ClipboardViewStateClass();
    });

    it('sets selectedIndex=0 and selectedItem to the first item when items are added', () => {
        const items = [
            { id: '1', content: 'first', type: 'text' as any, createdAt: 1, favorite: false, preview: 'first' },
            { id: '2', content: 'second', type: 'text' as any, createdAt: 2, favorite: false, preview: 'second' },
        ];
        
        state.setItems(items);
        
        expect(state.items).toHaveLength(2);
        // This will FAIL (RED) because selectedIndex remains 0 but selectedItem remains null currently
        expect(state.selectedItem).toEqual(items[0]);
        expect(state.selectedIndex).toBe(0);
    });

    it('keeps selectedItem null when setting empty items', () => {
        state.setItems([]);
        expect(state.items).toHaveLength(0);
        expect(state.selectedItem).toBeNull();
    });
});

describe('Type filtering', () => {
  let state: ClipboardViewStateClass;

  beforeEach(() => {
    state = new ClipboardViewStateClass();
    const items = [
      { id: '1', content: 'hello', type: 'text' as any, createdAt: 1, favorite: false },
      { id: '2', content: '<b>bold</b>', type: 'html' as any, createdAt: 2, favorite: false },
      { id: '3', content: '{\\rtf1}', type: 'rtf' as any, createdAt: 3, favorite: false },
      { id: '4', content: '/path/to/image.png', type: 'image' as any, createdAt: 4, favorite: false },
      { id: '5', content: '["/path/file.txt"]', type: 'files' as any, createdAt: 5, favorite: false },
    ];
    state.setItems(items);
  });

  it('returns all items when filter is "all"', () => {
    state.setTypeFilter('all');
    expect(state.getTypeFilteredItems()).toHaveLength(5);
  });

  it('returns text, html, rtf items when filter is "text"', () => {
    state.setTypeFilter('text');
    const filtered = state.getTypeFilteredItems();
    expect(filtered).toHaveLength(3);
    expect(filtered.every(i => ['text', 'html', 'rtf'].includes(i.type))).toBe(true);
  });

  it('returns only image items when filter is "images"', () => {
    state.setTypeFilter('images');
    const filtered = state.getTypeFilteredItems();
    expect(filtered).toHaveLength(1);
    expect(filtered[0].type).toBe('image');
  });

  it('returns only files items when filter is "files"', () => {
    state.setTypeFilter('files');
    const filtered = state.getTypeFilteredItems();
    expect(filtered).toHaveLength(1);
    expect(filtered[0].type).toBe('files');
  });

  it('reset() resets typeFilter to "all"', () => {
    state.setTypeFilter('images');
    state.reset();
    expect(state.typeFilter).toBe('all');
  });
});

describe('deleteItem', () => {
  let state: ClipboardViewStateClass;
  let mockClipboardService: any;
  let mockLogService: any;

  beforeEach(() => {
    state = new ClipboardViewStateClass();
    mockClipboardService = {
      pasteItem: vi.fn().mockResolvedValue(true),
      hideWindow: vi.fn(),
      getRecentItems: vi.fn().mockResolvedValue([]),
      deleteItem: vi.fn().mockResolvedValue(true),
      clearNonFavorites: vi.fn().mockResolvedValue(true),
      toggleItemFavorite: vi.fn().mockResolvedValue(true),
    };
    mockLogService = {
      error: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
    };
    const context = {
      getService: (name: string) => {
        if (name === "ClipboardHistoryService") return mockClipboardService;
        if (name === "LogService") return mockLogService;
        return null;
      }
    };
    state.initializeServices(context as any);
  });

  it('calls clipboardService.deleteItem and refreshes history on success', async () => {
    const result = await state.deleteItem('item-1');
    expect(result).toBe(true);
    expect(mockClipboardService.deleteItem).toHaveBeenCalledWith('item-1');
    expect(mockClipboardService.getRecentItems).toHaveBeenCalled(); // refreshHistory was called
  });

  it('returns false when service is not initialized', async () => {
    const uninitState = new ClipboardViewStateClass();
    const result = await uninitState.deleteItem('item-1');
    expect(result).toBe(false);
  });

  it('returns false and logs error on service failure', async () => {
    mockClipboardService.deleteItem.mockRejectedValue(new Error('fail'));
    const result = await state.deleteItem('item-1');
    expect(result).toBe(false);
    expect(mockLogService.error).toHaveBeenCalled();
  });
});

describe('HTML sanitization helpers', () => {
  // Pure helper functions replicated from DefaultView.svelte for testing
  function sanitizeHtml(html: string): string {
    // Strip <script> tags and their content
    let clean = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
    // Strip on* event handler attributes
    clean = clean.replace(/\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
    return clean;
  }

  function escapeHtml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  it('strips script tags from HTML', () => {
    const dirty = '<p>Hello</p><script>alert("xss")</script><p>World</p>';
    expect(sanitizeHtml(dirty)).toBe('<p>Hello</p><p>World</p>');
  });

  it('strips onclick and other event handlers', () => {
    const dirty = '<button onclick="alert(1)" onmouseover="hack()">Click</button>';
    const clean = sanitizeHtml(dirty);
    expect(clean).not.toContain('onclick');
    expect(clean).not.toContain('onmouseover');
    expect(clean).toContain('Click');
  });

  it('preserves safe HTML content', () => {
    const safe = '<p>Hello <strong>World</strong></p>';
    expect(sanitizeHtml(safe)).toBe(safe);
  });

  it('escapes HTML entities', () => {
    expect(escapeHtml('<script>alert("xss")</script>')).toBe('&lt;script&gt;alert("xss")&lt;/script&gt;');
  });

  it('escapes ampersands', () => {
    expect(escapeHtml('a & b')).toBe('a &amp; b');
  });
});

describe('showRenderedHtml state', () => {
  let state: ClipboardViewStateClass;

  beforeEach(() => {
    state = new ClipboardViewStateClass();
  });

  it('defaults to false', () => {
    expect(state.showRenderedHtml).toBe(false);
  });

  it('toggleHtmlView() toggles the value', () => {
    state.toggleHtmlView();
    expect(state.showRenderedHtml).toBe(true);
    state.toggleHtmlView();
    expect(state.showRenderedHtml).toBe(false);
  });

  it('reset() resets showRenderedHtml to false', () => {
    state.toggleHtmlView();
    state.reset();
    expect(state.showRenderedHtml).toBe(false);
  });

  it('setSelectedItem resets showRenderedHtml', () => {
    const items = [
      { id: '1', content: '<b>html</b>', type: 'html' as any, createdAt: 1, favorite: false },
      { id: '2', content: 'text', type: 'text' as any, createdAt: 2, favorite: false },
    ];
    state.setItems(items);
    state.toggleHtmlView();
    expect(state.showRenderedHtml).toBe(true);
    state.setSelectedItem(1);
    expect(state.showRenderedHtml).toBe(false);
  });

  it('moveSelection resets showRenderedHtml', () => {
    const items = [
      { id: '1', content: '<b>html</b>', type: 'html' as any, createdAt: 1, favorite: false },
      { id: '2', content: 'text', type: 'text' as any, createdAt: 2, favorite: false },
    ];
    state.setItems(items);
    state.toggleHtmlView();
    expect(state.showRenderedHtml).toBe(true);
    state.moveSelection('down');
    expect(state.showRenderedHtml).toBe(false);
  });
});
