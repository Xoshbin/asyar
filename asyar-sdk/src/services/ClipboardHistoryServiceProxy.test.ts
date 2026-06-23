import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ClipboardHistoryServiceProxy } from './ClipboardHistoryServiceProxy';
import { messageBroker } from '../ipc/MessageBroker';
import { ClipboardItemType } from '../types';
import type { ClipboardHistoryItem } from '../types';

vi.mock('../ipc/MessageBroker', () => ({
  messageBroker: {
      invoke: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
    },
}));

function makeProxy() {
  const mockInvoke = vi.fn().mockResolvedValue(undefined);
  Object.assign(messageBroker, {
    invoke: mockInvoke,
    on: vi.fn(),
    off: vi.fn(),
  });
  const proxy = new ClipboardHistoryServiceProxy();
  proxy.setExtensionId('ext.test');
  return { proxy, mockInvoke };
}

function makeItem(overrides?: Partial<ClipboardHistoryItem>): ClipboardHistoryItem {
  return {
    id: 'item-1',
    type: ClipboardItemType.Text,
    content: 'hello',
    createdAt: Date.now(),
    favorite: false,
    ...overrides,
  };
}

describe('ClipboardHistoryServiceProxy', () => {
  beforeEach(() => vi.clearAllMocks());

  // ── IPC methods ─────────────────────────────────────────────────────────────

  it('initialize → "clipboard:initialize"', async () => {
    const { proxy, mockInvoke } = makeProxy();
    await proxy.initialize();
    const call = mockInvoke.mock.calls.find(
      (c: unknown[]) => c[0] === 'clipboard:initialize',
    );
    expect(call).toBeDefined();
  });

  it('stopMonitoring → "clipboard:stopMonitoring" (fire-and-forget)', async () => {
    const { proxy, mockInvoke } = makeProxy();
    proxy.stopMonitoring();
    await vi.waitFor(() => expect(mockInvoke).toHaveBeenCalled());
    const call = mockInvoke.mock.calls.find(
      (c: unknown[]) => c[0] === 'clipboard:stopMonitoring',
    );
    expect(call).toBeDefined();
  });

  it('pasteItem → "clipboard:pasteItem" with item', async () => {
    const { proxy, mockInvoke } = makeProxy();
    const item = makeItem();
    await proxy.pasteItem(item);
    const call = mockInvoke.mock.calls.find(
      (c: unknown[]) => c[0] === 'clipboard:pasteItem',
    );
    expect(call).toBeDefined();
    expect(call![1]).toMatchObject({ item });
  });

  it('hideWindow → "clipboard:hideWindow"', async () => {
    const { proxy, mockInvoke } = makeProxy();
    await proxy.hideWindow();
    const call = mockInvoke.mock.calls.find(
      (c: unknown[]) => c[0] === 'clipboard:hideWindow',
    );
    expect(call).toBeDefined();
  });

  it('simulatePaste → "clipboard:simulatePaste"', async () => {
    const { proxy, mockInvoke } = makeProxy();
    mockInvoke.mockResolvedValue(true);
    const result = await proxy.simulatePaste();
    const call = mockInvoke.mock.calls.find(
      (c: unknown[]) => c[0] === 'clipboard:simulatePaste',
    );
    expect(call).toBeDefined();
    expect(result).toBe(true);
  });

  it('writeToClipboard → "clipboard:writeToClipboard" with item', async () => {
    const { proxy, mockInvoke } = makeProxy();
    const item = makeItem();
    await proxy.writeToClipboard(item);
    const call = mockInvoke.mock.calls.find(
      (c: unknown[]) => c[0] === 'clipboard:writeToClipboard',
    );
    expect(call).toBeDefined();
    expect(call![1]).toMatchObject({ item });
  });

  it('getRecentItems → "clipboard:getRecentItems" with limit', async () => {
    const { proxy, mockInvoke } = makeProxy();
    mockInvoke.mockResolvedValue([]);
    await proxy.getRecentItems(10);
    const call = mockInvoke.mock.calls.find(
      (c: unknown[]) => c[0] === 'clipboard:getRecentItems',
    );
    expect(call).toBeDefined();
    expect(call![1]).toMatchObject({ limit: 10 });
  });

  it('getRecentItems without limit → "clipboard:getRecentItems"', async () => {
    const { proxy, mockInvoke } = makeProxy();
    mockInvoke.mockResolvedValue([]);
    await proxy.getRecentItems();
    const call = mockInvoke.mock.calls.find(
      (c: unknown[]) => c[0] === 'clipboard:getRecentItems',
    );
    expect(call).toBeDefined();
    expect(call![1]).toMatchObject({ limit: undefined });
  });

  it('toggleItemFavorite → "clipboard:toggleItemFavorite" with itemId', async () => {
    const { proxy, mockInvoke } = makeProxy();
    mockInvoke.mockResolvedValue(true);
    const result = await proxy.toggleItemFavorite('item-1');
    const call = mockInvoke.mock.calls.find(
      (c: unknown[]) => c[0] === 'clipboard:toggleItemFavorite',
    );
    expect(call).toBeDefined();
    expect(call![1]).toMatchObject({ itemId: 'item-1' });
    expect(result).toBe(true);
  });

  it('deleteItem → "clipboard:deleteItem" with itemId', async () => {
    const { proxy, mockInvoke } = makeProxy();
    mockInvoke.mockResolvedValue(true);
    const result = await proxy.deleteItem('item-1');
    const call = mockInvoke.mock.calls.find(
      (c: unknown[]) => c[0] === 'clipboard:deleteItem',
    );
    expect(call).toBeDefined();
    expect(call![1]).toMatchObject({ itemId: 'item-1' });
    expect(result).toBe(true);
  });

  it('clearNonFavorites → "clipboard:clearNonFavorites"', async () => {
    const { proxy, mockInvoke } = makeProxy();
    mockInvoke.mockResolvedValue(true);
    const result = await proxy.clearNonFavorites();
    const call = mockInvoke.mock.calls.find(
      (c: unknown[]) => c[0] === 'clipboard:clearNonFavorites',
    );
    expect(call).toBeDefined();
    expect(result).toBe(true);
  });

  it('readCurrentClipboard → "clipboard:readCurrentClipboard"', async () => {
    const { proxy, mockInvoke } = makeProxy();
    const payload = { type: ClipboardItemType.Text, content: 'abc' };
    mockInvoke.mockResolvedValue(payload);
    const result = await proxy.readCurrentClipboard();
    const call = mockInvoke.mock.calls.find(
      (c: unknown[]) => c[0] === 'clipboard:readCurrentClipboard',
    );
    expect(call).toBeDefined();
    expect(result).toEqual(payload);
  });

  it('readCurrentText → "clipboard:readCurrentText"', async () => {
    const { proxy, mockInvoke } = makeProxy();
    mockInvoke.mockResolvedValue('clipboard text');
    const result = await proxy.readCurrentText();
    const call = mockInvoke.mock.calls.find(
      (c: unknown[]) => c[0] === 'clipboard:readCurrentText',
    );
    expect(call).toBeDefined();
    expect(result).toBe('clipboard text');
  });

  it('stripHtml → "clipboard:stripHtml" with html', async () => {
    const { proxy, mockInvoke } = makeProxy();
    mockInvoke.mockResolvedValue('hello');
    const result = await proxy.stripHtml('<b>hello</b>');
    const call = mockInvoke.mock.calls.find(
      (c: unknown[]) => c[0] === 'clipboard:stripHtml',
    );
    expect(call).toBeDefined();
    expect(call![1]).toMatchObject({ html: '<b>hello</b>' });
    expect(result).toBe('hello');
  });

  it('stripRtf → "clipboard:stripRtf" with rtf', async () => {
    const { proxy, mockInvoke } = makeProxy();
    mockInvoke.mockResolvedValue('hello');
    const result = await proxy.stripRtf('{\\rtf1 hello}');
    const call = mockInvoke.mock.calls.find(
      (c: unknown[]) => c[0] === 'clipboard:stripRtf',
    );
    expect(call).toBeDefined();
    expect(call![1]).toMatchObject({ rtf: '{\\rtf1 hello}' });
    expect(result).toBe('hello');
  });

  // ── Sync methods (no broker) ────────────────────────────────────────────────

  describe('formatClipboardItem', () => {
    it('Text item returns content', () => {
      const proxy = new ClipboardHistoryServiceProxy();
      const item = makeItem({ type: ClipboardItemType.Text, content: 'hello' });
      expect(proxy.formatClipboardItem(item)).toBe('hello');
    });

    it('Html item returns content', () => {
      const proxy = new ClipboardHistoryServiceProxy();
      const item = makeItem({ type: ClipboardItemType.Html, content: '<b>hi</b>' });
      expect(proxy.formatClipboardItem(item)).toBe('<b>hi</b>');
    });

    it('Text item with empty content returns empty string', () => {
      const proxy = new ClipboardHistoryServiceProxy();
      const item = makeItem({ type: ClipboardItemType.Text, content: '' });
      expect(proxy.formatClipboardItem(item)).toBe('');
    });

    it('Rtf item returns content or fallback', () => {
      const proxy = new ClipboardHistoryServiceProxy();
      expect(
        proxy.formatClipboardItem(makeItem({ type: ClipboardItemType.Rtf, content: 'rtf data' })),
      ).toBe('rtf data');
      expect(
        proxy.formatClipboardItem(makeItem({ type: ClipboardItemType.Rtf, content: undefined })),
      ).toBe('[RTF item]');
    });

    it('Files item returns file count', () => {
      const proxy = new ClipboardHistoryServiceProxy();
      const item = makeItem({
        type: ClipboardItemType.Files,
        content: JSON.stringify(['/a', '/b', '/c']),
      });
      expect(proxy.formatClipboardItem(item)).toBe('[3 files]');
    });

    it('Files item with one file uses singular', () => {
      const proxy = new ClipboardHistoryServiceProxy();
      const item = makeItem({
        type: ClipboardItemType.Files,
        content: JSON.stringify(['/a']),
      });
      expect(proxy.formatClipboardItem(item)).toBe('[1 file]');
    });

    it('Files item with invalid JSON returns fallback', () => {
      const proxy = new ClipboardHistoryServiceProxy();
      const item = makeItem({
        type: ClipboardItemType.Files,
        content: 'not json',
      });
      expect(proxy.formatClipboardItem(item)).toBe('[Files]');
    });

    it('Image item returns type label', () => {
      const proxy = new ClipboardHistoryServiceProxy();
      const item = makeItem({ type: ClipboardItemType.Image });
      expect(proxy.formatClipboardItem(item)).toBe('[image item]');
    });
  });

  describe('normalizeImageData', () => {
    it('returns content as-is if already a data URL', () => {
      const proxy = new ClipboardHistoryServiceProxy();
      const dataUrl = 'data:image/png;base64,abc123';
      expect(proxy.normalizeImageData(dataUrl)).toBe(dataUrl);
    });

    it('prepends data URL prefix for raw base64', () => {
      const proxy = new ClipboardHistoryServiceProxy();
      expect(proxy.normalizeImageData('abc123')).toBe(
        'data:image/png;base64,abc123',
      );
    });
  });

  describe('isValidImageData', () => {
    it('returns true for data URL', () => {
      const proxy = new ClipboardHistoryServiceProxy();
      expect(proxy.isValidImageData('data:image/png;base64,abc')).toBe(true);
    });

    it('returns true for valid base64 string', () => {
      const proxy = new ClipboardHistoryServiceProxy();
      expect(proxy.isValidImageData('SGVsbG8=')).toBe(true);
    });

    it('returns false for invalid data', () => {
      const proxy = new ClipboardHistoryServiceProxy();
      expect(proxy.isValidImageData('not valid! @#$')).toBe(false);
    });
  });
});
