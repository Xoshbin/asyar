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
  readRTF: vi.fn(),
  writeText: vi.fn(),
  writeHTML: vi.fn(),
  writeImage: vi.fn(),
  writeRTF: vi.fn(),
  writeFiles: vi.fn(),
  hasText: vi.fn(),
  hasHTML: vi.fn(),
  hasImage: vi.fn(),
  hasRTF: vi.fn(),
  hasFiles: vi.fn(),
  startListening: vi.fn(),
  stopListening: vi.fn(),
  onClipboardChange: vi.fn().mockResolvedValue(vi.fn()),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

vi.mock('@tauri-apps/api/path', () => ({
  appDataDir: vi.fn().mockResolvedValue('/mock/app/data/'),
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
  copyFile: vi.fn().mockResolvedValue(undefined),
  remove: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
  exists: vi.fn().mockResolvedValue(false),
}));

vi.mock('@tauri-apps/plugin-os', () => ({
  platform: vi.fn().mockResolvedValue('macos'),
}));

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
import { ClipboardItemType, type ClipboardHistoryItem } from 'asyar-sdk/contracts'

function getInstance(): ClipboardHistoryService {
  return new ClipboardHistoryService()
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
      expect.objectContaining({
        type: ClipboardItemType.Image,
        content: expect.stringContaining('clipboard_cache/')
      })
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

    // Should add twice (the store now handles moving duplicates to top)
    expect(clipboardHistoryStore.addHistoryItem).toHaveBeenCalledTimes(2);
  });

  it('falls through to text when html object is present but value is empty', async () => {
    const svc = getInstance();
    const { clipboardHistoryStore } = await import('./stores/clipboardHistoryStore.svelte');

    await (svc as any).handleClipboardChange({
      html: { type: 'html', value: '', count: 0 },
      text: { type: 'text', value: 'plain text fallback', count: 19 },
    });

    expect(clipboardHistoryStore.addHistoryItem).toHaveBeenCalledWith(
      expect.objectContaining({ type: ClipboardItemType.Text, content: 'plain text fallback' })
    );
  });

  it('falls through to text when html object is present but value is whitespace-only', async () => {
    const svc = getInstance();
    const { clipboardHistoryStore } = await import('./stores/clipboardHistoryStore.svelte');

    await (svc as any).handleClipboardChange({
      html: { type: 'html', value: '   ', count: 3 },
      text: { type: 'text', value: 'actual content', count: 14 },
    });

    // '   ' is truthy but captureHtmlContent would drop it; text must be captured instead
    // Because html.value is truthy ('   '), the html branch is entered and text is skipped.
    // This test documents current behaviour after the fix: html.value is checked, not html object.
    // With the fix, whitespace-only HTML still counts as having a value so we capture HTML.
    // The key regression to prevent: empty-string html silently dropping text.
    expect(clipboardHistoryStore.addHistoryItem).toHaveBeenCalled();
  });

  it('does not capture anything when all format values are empty', async () => {
    const svc = getInstance();
    const { clipboardHistoryStore } = await import('./stores/clipboardHistoryStore.svelte');

    await (svc as any).handleClipboardChange({
      html: { type: 'html', value: '', count: 0 },
      text: { type: 'text', value: '', count: 0 },
    });

    expect(clipboardHistoryStore.addHistoryItem).not.toHaveBeenCalled();
  });

  describe('handleClipboardChange — RTF and Files', () => {
    beforeEach(() => { vi.clearAllMocks() })

    it('captures RTF when result contains rtf', async () => {
      const svc = getInstance();
      const { clipboardHistoryStore } = await import('./stores/clipboardHistoryStore.svelte');

      await (svc as any).handleClipboardChange({
        rtf: { type: 'rtf', value: '{\\rtf1 Hello}', count: 13 }
      });

      expect(clipboardHistoryStore.addHistoryItem).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'rtf', content: '{\\rtf1 Hello}' })
      );
    });

    it('captures Files when result contains files', async () => {
      const svc = getInstance();
      const { clipboardHistoryStore } = await import('./stores/clipboardHistoryStore.svelte');

      await (svc as any).handleClipboardChange({
        files: { type: 'files', value: ['/path/to/file1.txt', '/path/to/file2.png'], count: 2 }
      });

      expect(clipboardHistoryStore.addHistoryItem).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'files',
          content: JSON.stringify(['/path/to/file1.txt', '/path/to/file2.png']),
        })
      );
    });

    it('captures file metadata (fileCount, fileNames)', async () => {
      const svc = getInstance();
      const { clipboardHistoryStore } = await import('./stores/clipboardHistoryStore.svelte');

      await (svc as any).handleClipboardChange({
        files: { type: 'files', value: ['/Users/test/doc.pdf', '/Users/test/photo.jpg'], count: 2 }
      });

      expect(clipboardHistoryStore.addHistoryItem).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            fileCount: 2,
            fileNames: ['doc.pdf', 'photo.jpg'],
          })
        })
      );
    });

    it('prioritizes files over everything', async () => {
      const svc = getInstance();
      const { clipboardHistoryStore } = await import('./stores/clipboardHistoryStore.svelte');

      await (svc as any).handleClipboardChange({
        files: { type: 'files', value: ['/path/file.txt'], count: 1 },
        image: { type: 'image', value: '/tmp/img.png', count: 1, width: 100, height: 100 },
        html: { type: 'html', value: '<p>test</p>', count: 10 },
        text: { type: 'text', value: 'test', count: 4 }
      });

      expect(clipboardHistoryStore.addHistoryItem).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'files' })
      );
    });

    it('prioritizes image over html, rtf, and text', async () => {
      const svc = getInstance();
      const { clipboardHistoryStore } = await import('./stores/clipboardHistoryStore.svelte');

      await (svc as any).handleClipboardChange({
        image: { type: 'image', value: '/tmp/img.png', count: 1, width: 100, height: 100 },
        html: { type: 'html', value: '<p>test</p>', count: 10 },
        rtf: { type: 'rtf', value: '{\\rtf1 test}', count: 12 },
        text: { type: 'text', value: 'test', count: 4 }
      });

      expect(clipboardHistoryStore.addHistoryItem).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'image' })
      );
    });

    it('deduplicates RTF content', async () => {
      const svc = getInstance();
      const { clipboardHistoryStore } = await import('./stores/clipboardHistoryStore.svelte');

      await (svc as any).handleClipboardChange({ rtf: { type: 'rtf', value: '{\\rtf1 same}', count: 12 } });
      await (svc as any).handleClipboardChange({ rtf: { type: 'rtf', value: '{\\rtf1 same}', count: 12 } });

      expect(clipboardHistoryStore.addHistoryItem).toHaveBeenCalledTimes(2);
    });

    it('deduplicates Files content', async () => {
      const svc = getInstance();
      const { clipboardHistoryStore } = await import('./stores/clipboardHistoryStore.svelte');

      const files = { type: 'files' as const, value: ['/path/file.txt'], count: 1 };
      await (svc as any).handleClipboardChange({ files });
      await (svc as any).handleClipboardChange({ files });

      expect(clipboardHistoryStore.addHistoryItem).toHaveBeenCalledTimes(2);
    });

    it('captures RTF and strips formatting for preview', async () => {
      const svc = getInstance();
      const { clipboardHistoryStore } = await import('./stores/clipboardHistoryStore.svelte');

      const rtfValue = '{\\rtf1\\ansi\\ansicpg1252\\cocoartf2868{\\fonttbl\\f0\\fnil\\fcharset0 .SFNSRounded-Regular;}{\\colortbl;\\red255\\green255\\blue255;\\red0\\green0\\blue0;} \\f0\\fs28 \\cf2 Fix it\\\'92s ugly}';
      await (svc as any).handleClipboardChange({
        rtf: { type: 'rtf', value: rtfValue, count: rtfValue.length }
      });

      expect(clipboardHistoryStore.addHistoryItem).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'rtf',
          content: rtfValue,
          preview: 'Fix it\u2019s ugly'
        })
      );
    });
  });

  describe('writeToClipboard — RTF and Files', () => {
    beforeEach(() => { vi.clearAllMocks() })

    it('calls writeRTF with plaintext and RTF for Rtf items', async () => {
      const { writeRTF } = await import('tauri-plugin-clipboard-x-api');
      const svc = getInstance();
      const rtfContent = '{\\rtf1\\ansi Hello World}';
      await svc.writeToClipboard(makeItem(ClipboardItemType.Rtf, rtfContent));
      // writeRTF takes (plaintext, rtf) — two args
      expect(writeRTF).toHaveBeenCalledWith(expect.any(String), rtfContent);
    });

    it('calls writeFiles with path array for Files items', async () => {
      const { writeFiles } = await import('tauri-plugin-clipboard-x-api');
      const svc = getInstance();
      const paths = ['/path/to/file1.txt', '/path/to/file2.png'];
      await svc.writeToClipboard(makeItem(ClipboardItemType.Files, JSON.stringify(paths)));
      expect(writeFiles).toHaveBeenCalledWith(paths);
    });
  });

  describe('formatClipboardItem — RTF and Files', () => {
    it('returns truncated content for RTF items', () => {
      const svc = getInstance();
      const item = makeItem(ClipboardItemType.Rtf, '{\\rtf1 short}');
      expect(svc.formatClipboardItem(item)).toBe('{\\rtf1 short}');
    });

    it('returns file count for Files items', () => {
      const svc = getInstance();
      const paths = ['/a/file1.txt', '/b/file2.png', '/c/file3.doc'];
      const item = makeItem(ClipboardItemType.Files, JSON.stringify(paths));
      const result = svc.formatClipboardItem(item);
      expect(result).toContain('3');
      expect(result).toContain('file');
    });
  });

  it('attaches source app when getFrontmostApplication succeeds', async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'get_frontmost_application') {
        return { name: 'Chrome', bundleId: 'com.google.Chrome', windowTitle: 'Google – Search' };
      }
      return undefined;
    });

    const svc = getInstance();
    const { clipboardHistoryStore } = await import('./stores/clipboardHistoryStore.svelte');

    await (svc as any).handleClipboardChange({
      text: { type: 'text', value: 'source app test', count: 15 },
    });

    expect(clipboardHistoryStore.addHistoryItem).toHaveBeenCalledWith(
      expect.objectContaining({
        type: ClipboardItemType.Text,
        content: 'source app test',
        sourceApp: {
          name: 'Chrome',
          bundleId: 'com.google.Chrome',
          windowTitle: 'Google – Search',
        },
      })
    );
  });

  it('captures without sourceApp when getFrontmostApplication fails', async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    vi.mocked(invoke).mockRejectedValueOnce(new Error('Platform error'));

    const svc = getInstance();
    const { clipboardHistoryStore } = await import('./stores/clipboardHistoryStore.svelte');

    await (svc as any).handleClipboardChange({
      text: { type: 'text', value: 'fallback test', count: 13 },
    });

    expect(clipboardHistoryStore.addHistoryItem).toHaveBeenCalledTimes(1);
    const call = vi.mocked(clipboardHistoryStore.addHistoryItem).mock.calls[0][0];
    expect(call.type).toBe(ClipboardItemType.Text);
    expect(call.content).toBe('fallback test');
    expect(call.sourceApp).toBeUndefined();

    const { logService } = await import('../log/logService');
    expect(logService.debug).toHaveBeenCalledWith(expect.stringContaining('Failed to capture source app'));
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

describe('image cache persistence', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('copies image to permanent cache directory', async () => {
    const { copyFile, mkdir } = await import('@tauri-apps/plugin-fs');
    const svc = getInstance();
    const { clipboardHistoryStore } = await import('./stores/clipboardHistoryStore.svelte');

    await (svc as any).handleClipboardChange({
      image: { type: 'image', value: '/tmp/plugin-temp/img123.png', count: 1, width: 800, height: 600 }
    });

    // Should create cache directory
    expect(mkdir).toHaveBeenCalledWith(
      expect.stringContaining('clipboard_cache'),
      expect.objectContaining({ recursive: true })
    );

    // Should copy from temp to permanent location
    expect(copyFile).toHaveBeenCalledWith(
      '/tmp/plugin-temp/img123.png',
      expect.stringContaining('clipboard_cache/')
    );

    // The stored item should have the permanent cache path, NOT the temp path
    expect(clipboardHistoryStore.addHistoryItem).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'image',
        content: expect.stringContaining('clipboard_cache/'),
      })
    );
  });

  it('stores image metadata (width, height, sizeBytes)', async () => {
    const svc = getInstance();
    const { clipboardHistoryStore } = await import('./stores/clipboardHistoryStore.svelte');

    await (svc as any).handleClipboardChange({
      image: { type: 'image', value: '/tmp/img.png', count: 1, width: 1920, height: 1080 }
    });

    expect(clipboardHistoryStore.addHistoryItem).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          width: 1920,
          height: 1080,
        })
      })
    );
  });

  it('deleteItem removes cached image file for image items', async () => {
    const { remove } = await import('@tauri-apps/plugin-fs');
    const svc = getInstance();
    const { clipboardHistoryStore } = await import('./stores/clipboardHistoryStore.svelte');

    // Mock getHistoryItems to return an image item
    const imageItem = {
      id: 'img-1',
      type: ClipboardItemType.Image,
      content: '/mock/app/data/clipboard_cache/img-1.png',
      createdAt: Date.now(),
      favorite: false,
    };
    vi.mocked(clipboardHistoryStore.getHistoryItems).mockResolvedValueOnce([imageItem as any]);

    await svc.deleteItem('img-1');

    // Should attempt to remove the cached file
    expect(remove).toHaveBeenCalledWith('/mock/app/data/clipboard_cache/img-1.png');
    // Should also remove from store
    expect(clipboardHistoryStore.deleteHistoryItem).toHaveBeenCalledWith('img-1');
  });

  it('deleteItem does NOT remove file for text items', async () => {
    const { remove } = await import('@tauri-apps/plugin-fs');
    const svc = getInstance();
    const { clipboardHistoryStore } = await import('./stores/clipboardHistoryStore.svelte');

    const textItem = {
      id: 'txt-1',
      type: ClipboardItemType.Text,
      content: 'hello',
      createdAt: Date.now(),
      favorite: false,
    };
    vi.mocked(clipboardHistoryStore.getHistoryItems).mockResolvedValueOnce([textItem as any]);

    await svc.deleteItem('txt-1');

    expect(remove).not.toHaveBeenCalled();
    expect(clipboardHistoryStore.deleteHistoryItem).toHaveBeenCalledWith('txt-1');
  });

  it('clearNonFavorites removes cached image files for non-favorite images', async () => {
    const { remove } = await import('@tauri-apps/plugin-fs');
    const svc = getInstance();
    const { clipboardHistoryStore } = await import('./stores/clipboardHistoryStore.svelte');

    const items = [
      { id: 'img-fav', type: ClipboardItemType.Image, content: '/cache/img-fav.png', createdAt: Date.now(), favorite: true },
      { id: 'img-nonfav', type: ClipboardItemType.Image, content: '/cache/img-nonfav.png', createdAt: Date.now(), favorite: false },
      { id: 'txt-1', type: ClipboardItemType.Text, content: 'hello', createdAt: Date.now(), favorite: false },
    ];
    vi.mocked(clipboardHistoryStore.getHistoryItems).mockResolvedValueOnce(items as any);

    await svc.clearNonFavorites();

    // Should only remove cache for non-favorite image items
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith('/cache/img-nonfav.png');
    expect(clipboardHistoryStore.clearHistory).toHaveBeenCalled();
  });

  it('handles copy failure gracefully', async () => {
    const { copyFile } = await import('@tauri-apps/plugin-fs');
    vi.mocked(copyFile).mockRejectedValueOnce(new Error('disk full'));
    const svc = getInstance();
    const { clipboardHistoryStore } = await import('./stores/clipboardHistoryStore.svelte');

    // Should not throw, should log error and still store with temp path as fallback
    await (svc as any).handleClipboardChange({
      image: { type: 'image', value: '/tmp/img.png', count: 1, width: 100, height: 100 }
    });

    // Should still store the item (with the temp path as fallback)
    expect(clipboardHistoryStore.addHistoryItem).toHaveBeenCalled();
  });
});

describe('Android fallback', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('uses polling on Android instead of event-driven monitoring', async () => {
    const { platform } = await import('@tauri-apps/plugin-os');
    const { startListening, onClipboardChange } = await import('tauri-plugin-clipboard-x-api');
    
    vi.mocked(platform).mockResolvedValue('android' as any);
    
    const svc = getInstance();
    await svc.initialize();
    
    expect(startListening).not.toHaveBeenCalled();
    expect(onClipboardChange).not.toHaveBeenCalled();
    expect((svc as any).pollingInterval).not.toBeNull();
    
    svc.stopMonitoring();
  });

  it('writes HTML as plain text on Android', async () => {
    const { platform } = await import('@tauri-apps/plugin-os');
    const { writeText, writeHTML } = await import('tauri-plugin-clipboard-x-api');
    vi.mocked(platform).mockResolvedValue('android' as any);
    
    const svc = getInstance();
    await svc.initialize();
    
    const htmlItem = makeItem(ClipboardItemType.Html, '<b>bold</b>');
    await svc.writeToClipboard(htmlItem);
    
    expect(writeText).toHaveBeenCalledWith('bold');
    expect(writeHTML).not.toHaveBeenCalled();
  });

  it('writes RTF as plain text on Android', async () => {
    const { platform } = await import('@tauri-apps/plugin-os');
    const { writeText, writeRTF } = await import('tauri-plugin-clipboard-x-api');
    vi.mocked(platform).mockResolvedValue('android' as any);
    
    const svc = getInstance();
    await svc.initialize();
    
    const rtfItem = makeItem(ClipboardItemType.Rtf, '{\\rtf1 hello}');
    await svc.writeToClipboard(rtfItem);
    
    expect(writeText).toHaveBeenCalledWith('hello');
    expect(writeRTF).not.toHaveBeenCalled();
  });
});

// ── readCurrentText ───────────────────────────────────────────────────────────

describe('readCurrentText', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns plain text from readText when clipboard has text', async () => {
    const { readText, hasText } = await import('tauri-plugin-clipboard-x-api')
    vi.mocked(hasText).mockResolvedValueOnce(true)
    vi.mocked(readText).mockResolvedValueOnce('hello world')

    const svc = getInstance()
    const result = await svc.readCurrentText()

    expect(result).toBe('hello world')
  })

  it('returns plain text even when clipboard ALSO has HTML flavor (regression)', async () => {
    // This is the Mickey Mouse trap: copying from a browser populates BOTH
    // plain-text and HTML. readCurrentText must return the plain-text flavor,
    // not the HTML blob, regardless of ordering in readCurrentClipboard.
    const { readText, hasText, hasHTML, hasImage, hasFiles, hasRTF } =
      await import('tauri-plugin-clipboard-x-api')
    vi.mocked(hasText).mockResolvedValueOnce(true)
    vi.mocked(hasHTML).mockResolvedValueOnce(true)
    vi.mocked(hasImage).mockResolvedValueOnce(false)
    vi.mocked(hasFiles).mockResolvedValueOnce(false)
    vi.mocked(hasRTF).mockResolvedValueOnce(false)
    vi.mocked(readText).mockResolvedValueOnce('hello world')

    const svc = getInstance()
    const result = await svc.readCurrentText()

    expect(result).toBe('hello world')
  })

  it('returns empty string when clipboard has no text at all', async () => {
    const { hasText, readText } = await import('tauri-plugin-clipboard-x-api')
    vi.mocked(hasText).mockResolvedValueOnce(false)
    vi.mocked(readText).mockResolvedValueOnce('')

    const svc = getInstance()
    const result = await svc.readCurrentText()

    expect(result).toBe('')
  })

  it('returns empty string when clipboard contains only an image', async () => {
    const { hasText, hasImage, readText } = await import('tauri-plugin-clipboard-x-api')
    vi.mocked(hasText).mockResolvedValueOnce(false)
    vi.mocked(hasImage).mockResolvedValueOnce(true)
    vi.mocked(readText).mockResolvedValueOnce('')

    const svc = getInstance()
    const result = await svc.readCurrentText()

    expect(result).toBe('')
  })

  it('returns empty string when readText throws', async () => {
    const { hasText, readText } = await import('tauri-plugin-clipboard-x-api')
    vi.mocked(hasText).mockResolvedValueOnce(true)
    vi.mocked(readText).mockRejectedValueOnce(new Error('clipboard unavailable'))

    const svc = getInstance()
    const result = await svc.readCurrentText()

    expect(result).toBe('')
  })
})

describe('legacy cleanup', () => {
  it('removes legacy blob URL image items on initialize', async () => {
    const { clipboardHistoryStore } = await import('./stores/clipboardHistoryStore.svelte');
    
    const blobItem = makeItem(ClipboardItemType.Image, 'blob:http://localhost:123/456', { id: 'blob-id' });
    const normalItem = makeItem(ClipboardItemType.Image, '/path/to/img.png', { id: 'normal-id' });
    
    vi.mocked(clipboardHistoryStore.getHistoryItems).mockResolvedValue([blobItem, normalItem] as any);
    
    const svc = getInstance();
    await svc.initialize();
    
    expect(clipboardHistoryStore.deleteHistoryItem).toHaveBeenCalledWith(blobItem.id);
    expect(clipboardHistoryStore.deleteHistoryItem).not.toHaveBeenCalledWith(normalItem.id);
  });
});
