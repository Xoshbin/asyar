import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies BEFORE importing the module under test
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('../../services/clipboard/stores/clipboardHistoryStore.svelte', () => ({
  clipboardHistoryStore: {
    favorites: [],
    recent: [],
    searchResults: null,
    nextOlderCursor: undefined,
    loadInitial: vi.fn().mockResolvedValue(undefined),
    loadOlder: vi.fn().mockResolvedValue(undefined),
    search: vi.fn().mockResolvedValue(undefined),
    clearSearch: vi.fn(),
    fetchFullItem: vi.fn().mockResolvedValue(null),
    deleteHistoryItem: vi.fn().mockResolvedValue({ imageContentPath: undefined }),
  },
}));

vi.mock('../../services/feedback/feedbackService.svelte', () => ({
  feedbackService: { report: vi.fn() },
}));

vi.mock('../../services/log/logService', () => ({
  logService: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../lib/ipc/commands', () => ({
  checkAccessibilityPermission: vi.fn().mockResolvedValue(true),
  openAccessibilityPreferences: vi.fn().mockResolvedValue(undefined),
  clipboardGetMergedText: vi.fn().mockResolvedValue({ text: '', skippedCount: 0 }),
}));

import { ClipboardViewStateClass } from './state.svelte';
import { clipboardHistoryStore } from '../../services/clipboard/stores/clipboardHistoryStore.svelte';
import * as commands from '../../lib/ipc/commands';
import { feedbackService } from '../../services/feedback/feedbackService.svelte';

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
        if (name === 'clipboard') return mockClipboardService;
        if (name === 'log') return mockLogService;
        return null;
      },
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

  it('pasteAsPlainText strips HTML tags before pasting', async () => {
    const item = {
      id: '1',
      content: '<b>bold</b> and <i>italic</i>',
      type: 'html' as any,
      createdAt: 1,
      favorite: false,
    };
    state.setItems([item]);

    await state.pasteAsPlainText();

    expect(mockClipboardService.pasteItem).toHaveBeenCalled();
    const arg = mockClipboardService.pasteItem.mock.calls[0][0];
    expect(arg.type).toBe('text');
    expect(arg.content).toBe('bold and italic');
  });

  it('pasteAsPlainText strips RTF control words', async () => {
    const item = {
      id: '1',
      content: '{\\rtf1\\b hello\\b0 world}',
      type: 'rtf' as any,
      createdAt: 1,
      favorite: false,
    };
    state.setItems([item]);

    await state.pasteAsPlainText();

    const arg = mockClipboardService.pasteItem.mock.calls[0][0];
    expect(arg.type).toBe('text');
    expect(arg.content).not.toContain('\\rtf');
    expect(arg.content).toContain('hello');
  });

  it('pasteAsPlainText passes text content unchanged', async () => {
    const item = {
      id: '1',
      content: 'plain text',
      type: 'text' as any,
      createdAt: 1,
      favorite: false,
    };
    state.setItems([item]);

    await state.pasteAsPlainText();

    const arg = mockClipboardService.pasteItem.mock.calls[0][0];
    expect(arg.content).toBe('plain text');
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
      {
        id: '1',
        content: 'first',
        type: 'text' as any,
        createdAt: 1,
        favorite: false,
        preview: 'first',
      },
      {
        id: '2',
        content: 'second',
        type: 'text' as any,
        createdAt: 2,
        favorite: false,
        preview: 'second',
      },
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

describe('setItems sorts favorites first', () => {
  let state: ClipboardViewStateClass;

  beforeEach(() => {
    state = new ClipboardViewStateClass();
  });

  it('places favorite items before non-favorites', () => {
    const items = [
      { id: '1', content: 'a', type: 'text' as any, createdAt: 3, favorite: false },
      { id: '2', content: 'b', type: 'text' as any, createdAt: 2, favorite: true },
      { id: '3', content: 'c', type: 'text' as any, createdAt: 1, favorite: false },
    ];
    state.setItems(items);
    expect(state.items[0].id).toBe('2'); // favorite first
    expect(state.items[1].id).toBe('1');
    expect(state.items[2].id).toBe('3');
  });

  it('preserves order within favorites and non-favorites', () => {
    const items = [
      { id: '1', content: 'a', type: 'text' as any, createdAt: 4, favorite: true },
      { id: '2', content: 'b', type: 'text' as any, createdAt: 3, favorite: false },
      { id: '3', content: 'c', type: 'text' as any, createdAt: 2, favorite: true },
      { id: '4', content: 'd', type: 'text' as any, createdAt: 1, favorite: false },
    ];
    state.setItems(items);
    expect(state.items.map((i) => i.id)).toEqual(['1', '3', '2', '4']);
  });

  it('auto-selects the first item after sorting (favorite if any)', () => {
    const items = [
      { id: '1', content: 'a', type: 'text' as any, createdAt: 2, favorite: false },
      { id: '2', content: 'b', type: 'text' as any, createdAt: 1, favorite: true },
    ];
    state.setItems(items);
    expect(state.selectedItem?.id).toBe('2');
    expect(state.selectedIndex).toBe(0);
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
      {
        id: '4',
        content: '/path/to/image.png',
        type: 'image' as any,
        createdAt: 4,
        favorite: false,
      },
      {
        id: '5',
        content: '["/path/file.txt"]',
        type: 'files' as any,
        createdAt: 5,
        favorite: false,
      },
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
    expect(filtered.every((i) => ['text', 'html', 'rtf'].includes(i.type))).toBe(true);
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
        if (name === 'clipboard') return mockClipboardService;
        if (name === 'log') return mockLogService;
        return null;
      },
    };
    state.initializeServices(context as any);
  });

  it('calls clipboardService.deleteItem and removes item from store on success', async () => {
    const result = await state.deleteItem('item-1');
    expect(result).toBe(true);
    expect(mockClipboardService.deleteItem).toHaveBeenCalledWith('item-1');
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
    let clean = html;
    let prev = '';
    while (clean !== prev) {
      prev = clean;
      clean = clean.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
      clean = clean.replace(/\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
    }
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
    expect(escapeHtml('<script>alert("xss")</script>')).toBe(
      '&lt;script&gt;alert("xss")&lt;/script&gt;',
    );
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

  it('defaults to true (rendered mode by default)', () => {
    expect(state.showRenderedHtml).toBe(true);
  });

  it('toggleHtmlView() toggles the value', () => {
    state.toggleHtmlView();
    expect(state.showRenderedHtml).toBe(false);
    state.toggleHtmlView();
    expect(state.showRenderedHtml).toBe(true);
  });

  it('reset() resets showRenderedHtml to false', () => {
    state.toggleHtmlView(); // true -> false
    state.reset();
    expect(state.showRenderedHtml).toBe(false);
  });

  it('setSelectedItem preserves showRenderedHtml (user preference persists)', () => {
    const items = [
      { id: '1', content: '<b>html</b>', type: 'html' as any, createdAt: 1, favorite: false },
      { id: '2', content: 'text', type: 'text' as any, createdAt: 2, favorite: false },
    ];
    state.setItems(items);
    state.toggleHtmlView(); // true -> false
    expect(state.showRenderedHtml).toBe(false);
    state.setSelectedItem(1);
    expect(state.showRenderedHtml).toBe(false);
  });

  it('moveSelection preserves showRenderedHtml (user preference persists)', () => {
    const items = [
      { id: '1', content: '<b>html</b>', type: 'html' as any, createdAt: 1, favorite: false },
      { id: '2', content: 'text', type: 'text' as any, createdAt: 2, favorite: false },
    ];
    state.setItems(items);
    state.toggleHtmlView(); // true -> false
    expect(state.showRenderedHtml).toBe(false);
    state.moveSelection('down');
    expect(state.showRenderedHtml).toBe(false);
  });
});

describe('getPlainText', () => {
  let state: ClipboardViewStateClass;

  beforeEach(() => {
    state = new ClipboardViewStateClass();
  });

  it('returns stripped plain text for html items', async () => {
    const item = {
      id: '1',
      content: '<b>bold</b> and <i>italic</i>',
      type: 'html' as any,
      createdAt: 1,
      favorite: false,
    } as any;
    const plainText = await state.getPlainText(item);
    expect(plainText).toBe('bold and italic');
  });

  it('returns stripped plain text for rtf items', async () => {
    const item = {
      id: '1',
      content: '{\\rtf1\\b hello }world',
      type: 'rtf' as any,
      createdAt: 1,
      favorite: false,
    } as any;
    const plainText = await state.getPlainText(item);
    expect(plainText).not.toContain('\\rtf');
    expect(plainText).toContain('hello');
    expect(plainText).toBe('hello world');
  });

  it('returns content unchanged for text items', async () => {
    const item = {
      id: '1',
      content: 'plain text',
      type: 'text' as any,
      createdAt: 1,
      favorite: false,
    } as any;
    const plainText = await state.getPlainText(item);
    expect(plainText).toBe('plain text');
  });

  it('fetches the Rust-decrypted full row when given a list item', async () => {
    vi.mocked(clipboardHistoryStore.fetchFullItem).mockResolvedValueOnce({
      id: '1',
      content: 'token=AKIAIOSFODNN7EXAMPLE',
      preview: '[Encrypted secret]',
      redactedKinds: ['aws_access_key'],
      type: 'text',
      createdAt: 1,
      favorite: false,
    });
    const item = {
      id: '1',
      preview: '[Encrypted secret]',
      redactedKinds: ['aws_access_key'],
      type: 'text' as any,
      createdAt: 1,
      favorite: false,
    } as any;

    await expect(state.getPlainText(item)).resolves.toBe('token=AKIAIOSFODNN7EXAMPLE');
    expect(clipboardHistoryStore.fetchFullItem).toHaveBeenCalledWith('1');
  });
});

// The local SearchEngine path inside ClipboardViewStateClass is retired:
// search is now Rust-FTS-backed in clipboardHistoryStore and the view
// mirrors store.searchResults into clipboardViewState.items. The
// retired tests asserted that `state.setSearch(query)` would narrow
// `state.filteredItems` against `state.items`; that narrowing now
// happens server-side and is tested in the store's own test file.
// Type-filter behaviour is covered below.

describe('type filter (applied on top of store-mirrored items)', () => {
  let state: ClipboardViewStateClass;

  beforeEach(() => {
    state = new ClipboardViewStateClass();
    state.setItems([
      {
        id: '1',
        content: 'text item',
        preview: 'text item',
        type: 'text' as any,
        createdAt: 1,
        favorite: false,
      },
      {
        id: '2',
        content: '<p>html</p>',
        preview: 'html item',
        type: 'html' as any,
        createdAt: 2,
        favorite: false,
      },
      {
        id: '3',
        content: '/p.png',
        preview: '/p.png',
        type: 'image' as any,
        createdAt: 3,
        favorite: false,
      },
      {
        id: '4',
        content: '["/a.txt"]',
        preview: '1 file: a.txt',
        type: 'files' as any,
        createdAt: 4,
        favorite: false,
      },
    ]);
  });

  it('filter "all" returns everything', () => {
    state.setTypeFilter('all');
    expect(state.filteredItems.map((i) => i.id).sort()).toEqual(['1', '2', '3', '4']);
  });

  it('filter "text" returns text + html + rtf rows', () => {
    state.setTypeFilter('text');
    expect(state.filteredItems.map((i) => i.id).sort()).toEqual(['1', '2']);
  });

  it('filter "images" returns only image rows', () => {
    state.setTypeFilter('images');
    expect(state.filteredItems.map((i) => i.id)).toEqual(['3']);
  });

  it('filter "files" returns only file rows', () => {
    state.setTypeFilter('files');
    expect(state.filteredItems.map((i) => i.id)).toEqual(['4']);
  });
});

describe('toggleMultiSelect', () => {
  let state: ClipboardViewStateClass;

  beforeEach(() => {
    state = new ClipboardViewStateClass();
  });

  it('adds an id not yet selected and moves the cursor to it', () => {
    state.toggleMultiSelect('a');
    expect(state.selectedIds).toEqual(['a']);
    expect(state.selectedItemId).toBe('a');
  });

  it('removes an id already selected', () => {
    state.toggleMultiSelect('a');
    state.toggleMultiSelect('b');
    state.toggleMultiSelect('a');
    expect(state.selectedIds).toEqual(['b']);
  });

  it('preserves add-order across toggles', () => {
    state.toggleMultiSelect('c');
    state.toggleMultiSelect('a');
    state.toggleMultiSelect('b');
    expect(state.selectedIds).toEqual(['c', 'a', 'b']);
  });

  it('isMultiSelected reflects current membership', () => {
    state.toggleMultiSelect('a');
    expect(state.isMultiSelected('a')).toBe(true);
    expect(state.isMultiSelected('b')).toBe(false);
  });

  it('clearMultiSelect empties the selection', () => {
    state.toggleMultiSelect('a');
    state.toggleMultiSelect('b');
    state.clearMultiSelect();
    expect(state.selectedIds).toEqual([]);
  });
});

describe('moveSelectionAndExtend', () => {
  let state: ClipboardViewStateClass;

  beforeEach(() => {
    state = new ClipboardViewStateClass();
    state.setItems([
      { id: '1', content: 'a', type: 'text' as any, createdAt: 1, favorite: false },
      { id: '2', content: 'b', type: 'text' as any, createdAt: 2, favorite: false },
      { id: '3', content: 'c', type: 'text' as any, createdAt: 3, favorite: false },
    ]);
    // setItems auto-selects the first item ('1' after favorite-sort, since none are favorites — order preserved).
  });

  it('captures the starting cursor item then adds the newly-landed item', () => {
    state.moveSelectionAndExtend('down');
    // Started on '1', moved down to '2' — both should now be selected, in that order.
    expect(state.selectedIds).toEqual(['1', '2']);
    expect(state.selectedItemId).toBe('2');
  });

  it('keeps extending across repeated calls without duplicating', () => {
    state.moveSelectionAndExtend('down');
    state.moveSelectionAndExtend('down');
    expect(state.selectedIds).toEqual(['1', '2', '3']);
  });

  it('is add-only: moving back over an already-selected item does not remove it', () => {
    state.moveSelectionAndExtend('down'); // selects 1, 2 — cursor on 2
    state.moveSelectionAndExtend('down'); // selects 3 — cursor on 3
    state.moveSelectionAndExtend('up'); // cursor back to 2, already selected
    expect(state.selectedIds).toEqual(['1', '2', '3']);
    expect(state.selectedItemId).toBe('2');
  });
});

describe('pasteMergedSelection', () => {
  let state: ClipboardViewStateClass;
  let mockClipboardService: any;
  let mockLogService: any;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(commands.checkAccessibilityPermission).mockResolvedValue(true);
    vi.mocked(commands.clipboardGetMergedText).mockResolvedValue({
      text: 'first\nsecond',
      skippedCount: 0,
    });

    state = new ClipboardViewStateClass();
    mockClipboardService = {
      pasteItem: vi.fn().mockResolvedValue(undefined),
      hideWindow: vi.fn(),
      getRecentItems: vi.fn().mockResolvedValue([]),
    };
    mockLogService = { error: vi.fn(), debug: vi.fn(), warn: vi.fn() };
    state.initializeServices({
      getService: (name: string) => {
        if (name === 'clipboard') return mockClipboardService;
        if (name === 'log') return mockLogService;
        return null;
      },
    } as any);

    state.toggleMultiSelect('1');
    state.toggleMultiSelect('2');
  });

  it('does nothing when fewer than 2 items are selected', async () => {
    state.clearMultiSelect();
    state.toggleMultiSelect('1');

    await state.pasteMergedSelection();

    expect(commands.clipboardGetMergedText).not.toHaveBeenCalled();
    expect(mockClipboardService.pasteItem).not.toHaveBeenCalled();
  });

  it('fetches merged text in selection order and pastes it as a single text item', async () => {
    await state.pasteMergedSelection();

    expect(commands.clipboardGetMergedText).toHaveBeenCalledWith(['1', '2']);
    expect(mockClipboardService.pasteItem).toHaveBeenCalledTimes(1);
    const arg = mockClipboardService.pasteItem.mock.calls[0][0];
    expect(arg.type).toBe('text');
    expect(arg.content).toBe('first\nsecond');
  });

  it('clears the selection after a successful merge paste', async () => {
    await state.pasteMergedSelection();
    expect(state.selectedIds).toEqual([]);
  });

  it('does not clear the selection when accessibility permission is denied', async () => {
    vi.mocked(commands.checkAccessibilityPermission).mockResolvedValue(false);

    await state.pasteMergedSelection();

    expect(commands.openAccessibilityPreferences).toHaveBeenCalled();
    expect(commands.clipboardGetMergedText).not.toHaveBeenCalled();
    expect(mockClipboardService.pasteItem).not.toHaveBeenCalled();
    expect(state.selectedIds).toEqual(['1', '2']);
  });

  it('reports skipped items via feedbackService without blocking the paste', async () => {
    vi.mocked(commands.clipboardGetMergedText).mockResolvedValue({
      text: 'first',
      skippedCount: 1,
    });

    await state.pasteMergedSelection();

    expect(mockClipboardService.pasteItem).toHaveBeenCalledTimes(1);
    expect(feedbackService.report).toHaveBeenCalled();
  });

  it('does not paste and preserves the selection when merged text is empty', async () => {
    vi.mocked(commands.clipboardGetMergedText).mockResolvedValue({
      text: '',
      skippedCount: 2,
    });

    await state.pasteMergedSelection();

    expect(mockClipboardService.pasteItem).not.toHaveBeenCalled();
    expect(state.selectedIds).toEqual(['1', '2']);
    expect(feedbackService.report).toHaveBeenCalled();
  });
});
