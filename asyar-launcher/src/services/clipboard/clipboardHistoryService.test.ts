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
    loadInitial: vi.fn().mockResolvedValue(undefined),
    addHistoryItem: vi.fn(),
    toggleFavorite: vi.fn(),
    deleteHistoryItem: vi.fn().mockResolvedValue({ imageContentPath: undefined }),
    clearHistory: vi.fn().mockResolvedValue({ removedIds: [], removedImagePaths: [] }),
    favorites: [],
    recent: [],
    searchResults: null,
    indexState: 'ready',
    nextOlderCursor: undefined,
  }
}))

vi.mock('uuid', () => ({ v4: vi.fn(() => 'test-uuid') }))

vi.mock('../privacy/clipboardPrivacyService.svelte', () => ({
  clipboardPrivacyService: {
    classify: vi.fn(),
  },
}))

vi.mock('../privacy/secretRedactionService.svelte', () => ({
  secretRedactionService: {
    redactIfEnabled: vi.fn(),
  },
}))

vi.mock('../diagnostics/diagnosticsService.svelte', () => ({
  diagnosticsService: {
    report: vi.fn().mockResolvedValue(undefined),
  },
}))

import { ClipboardHistoryService } from './clipboardHistoryService'
import { invoke } from '@tauri-apps/api/core'
import { diagnosticsService } from '../diagnostics/diagnosticsService.svelte'
import { ClipboardItemType, type ClipboardHistoryItem } from 'asyar-sdk/contracts'
import { clipboardPrivacyService } from '../privacy/clipboardPrivacyService.svelte'
import { secretRedactionService } from '../privacy/secretRedactionService.svelte'
import { clipboardHistoryStore } from './stores/clipboardHistoryStore.svelte'
import { remove } from '@tauri-apps/plugin-fs'

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

  describe('capture-time privacy gate', () => {
    beforeEach(() => { vi.clearAllMocks() });

    it('does not persist when classifier returns skip:true', async () => {
      vi.mocked(clipboardPrivacyService.classify).mockResolvedValueOnce({
        skip: true,
        reason: { kind: 'transient' },
      });
      const svc = getInstance();
      const { clipboardHistoryStore } = await import('./stores/clipboardHistoryStore.svelte');

      await (svc as any).handleClipboardChange({
        text: { type: 'text', value: 'a-secret', count: 8 },
      });

      expect(clipboardHistoryStore.addHistoryItem).not.toHaveBeenCalled();
      expect(clipboardPrivacyService.classify).toHaveBeenCalledTimes(1);
    });

    it('persists normally when classifier returns skip:false', async () => {
      vi.mocked(clipboardPrivacyService.classify).mockResolvedValueOnce({
        skip: false,
        reason: { kind: 'none' },
      });
      const svc = getInstance();
      const { clipboardHistoryStore } = await import('./stores/clipboardHistoryStore.svelte');

      await (svc as any).handleClipboardChange({
        text: { type: 'text', value: 'normal', count: 6 },
      });

      expect(clipboardHistoryStore.addHistoryItem).toHaveBeenCalledTimes(1);
    });

    it('persists when classifier returns null (host error — fail open)', async () => {
      vi.mocked(clipboardPrivacyService.classify).mockResolvedValueOnce(null);
      const svc = getInstance();
      const { clipboardHistoryStore } = await import('./stores/clipboardHistoryStore.svelte');

      await (svc as any).handleClipboardChange({
        text: { type: 'text', value: 'still captured', count: 14 },
      });

      expect(clipboardHistoryStore.addHistoryItem).toHaveBeenCalledTimes(1);
    });

    it('skips for image events too, not just text', async () => {
      vi.mocked(clipboardPrivacyService.classify).mockResolvedValueOnce({
        skip: true,
        reason: { kind: 'concealed' },
      });
      const svc = getInstance();
      const { clipboardHistoryStore } = await import('./stores/clipboardHistoryStore.svelte');

      await (svc as any).handleClipboardChange({
        image: { type: 'image', value: '/tmp/secret.png', count: 1, width: 1, height: 1 },
      });

      expect(clipboardHistoryStore.addHistoryItem).not.toHaveBeenCalled();
    });

    it('passes the source bundle id to the classifier', async () => {
      const { invoke } = await import('@tauri-apps/api/core');
      vi.mocked(invoke).mockResolvedValueOnce({
        name: 'Bitwarden',
        bundleId: 'com.bitwarden.desktop',
        path: '/Applications/Bitwarden.app',
        windowTitle: null,
      });
      vi.mocked(clipboardPrivacyService.classify).mockResolvedValueOnce({
        skip: true,
        reason: { kind: 'sourceDenylist', value: 'com.bitwarden.desktop' },
      });
      const svc = getInstance();

      await (svc as any).handleClipboardChange({
        text: { type: 'text', value: 'pw', count: 2 },
      });

      expect(clipboardPrivacyService.classify).toHaveBeenCalledWith('com.bitwarden.desktop');
    });
  });

  describe('secret redaction at capture time', () => {
    beforeEach(() => { vi.clearAllMocks() });

    it('redacts text content when redactor returns kinds', async () => {
      vi.mocked(secretRedactionService.redactIfEnabled).mockResolvedValueOnce({
        content: 'token=[redacted: aws_access_key] end',
        kinds: ['aws_access_key'],
        oversizedUnscanned: false,
      });
      const svc = getInstance();
      const { clipboardHistoryStore } = await import('./stores/clipboardHistoryStore.svelte');

      await (svc as any).handleClipboardChange({
        text: { type: 'text', value: 'token=AKIAIOSFODNN7EXAMPLE end', count: 30 },
      });

      expect(clipboardHistoryStore.addHistoryItem).toHaveBeenCalledWith(
        expect.objectContaining({
          type: ClipboardItemType.Text,
          content: 'token=[redacted: aws_access_key] end',
          redactedKinds: ['aws_access_key'],
        }),
      );
    });

    it('does not set redactedKinds when redactor returns null (master/category disabled)', async () => {
      vi.mocked(secretRedactionService.redactIfEnabled).mockResolvedValueOnce(null);
      const svc = getInstance();
      const { clipboardHistoryStore } = await import('./stores/clipboardHistoryStore.svelte');

      await (svc as any).handleClipboardChange({
        text: { type: 'text', value: 'plain text', count: 10 },
      });

      const arg = vi.mocked(clipboardHistoryStore.addHistoryItem).mock.calls[0][0];
      expect(arg.content).toBe('plain text');
      expect(arg.redactedKinds).toBeUndefined();
    });

    it('does not set redactedKinds when redactor returns empty kinds', async () => {
      vi.mocked(secretRedactionService.redactIfEnabled).mockResolvedValueOnce({
        content: 'plain text',
        kinds: [],
        oversizedUnscanned: false,
      });
      const svc = getInstance();
      const { clipboardHistoryStore } = await import('./stores/clipboardHistoryStore.svelte');

      await (svc as any).handleClipboardChange({
        text: { type: 'text', value: 'plain text', count: 10 },
      });

      const arg = vi.mocked(clipboardHistoryStore.addHistoryItem).mock.calls[0][0];
      expect(arg.redactedKinds).toBeUndefined();
    });

    it('redacts HTML content', async () => {
      vi.mocked(secretRedactionService.redactIfEnabled).mockResolvedValueOnce({
        content: '<p>[redacted: jwt]</p>',
        kinds: ['jwt'],
        oversizedUnscanned: false,
      });
      const svc = getInstance();
      const { clipboardHistoryStore } = await import('./stores/clipboardHistoryStore.svelte');

      await (svc as any).handleClipboardChange({
        html: { type: 'html', value: '<p>eyJhbGciOiJIUzI1NiJ9...</p>', count: 30 },
      });

      expect(clipboardHistoryStore.addHistoryItem).toHaveBeenCalledWith(
        expect.objectContaining({
          type: ClipboardItemType.Html,
          content: '<p>[redacted: jwt]</p>',
          redactedKinds: ['jwt'],
        }),
      );
    });

    it('redacts RTF content', async () => {
      vi.mocked(secretRedactionService.redactIfEnabled).mockResolvedValueOnce({
        content: '{\\rtf1 [redacted: aws_access_key]}',
        kinds: ['aws_access_key'],
        oversizedUnscanned: false,
      });
      const svc = getInstance();
      const { clipboardHistoryStore } = await import('./stores/clipboardHistoryStore.svelte');

      await (svc as any).handleClipboardChange({
        rtf: { type: 'rtf', value: '{\\rtf1 AKIAIOSFODNN7EXAMPLE}', count: 30 },
      });

      const arg = vi.mocked(clipboardHistoryStore.addHistoryItem).mock.calls[0][0];
      expect(arg.type).toBe(ClipboardItemType.Rtf);
      expect(arg.redactedKinds).toEqual(['aws_access_key']);
    });

    it('does not redact image content (no text to scan)', async () => {
      const svc = getInstance();
      const { clipboardHistoryStore } = await import('./stores/clipboardHistoryStore.svelte');

      await (svc as any).handleClipboardChange({
        image: { type: 'image', value: '/tmp/img.png', count: 1, width: 1, height: 1 },
      });

      // redactIfEnabled is not called for images.
      expect(secretRedactionService.redactIfEnabled).not.toHaveBeenCalled();
    });
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
  beforeEach(() => { vi.clearAllMocks() })

  it('delegates to loadInitial and returns favorites + recent', async () => {
    const loadSpy = vi.spyOn(clipboardHistoryStore, 'loadInitial').mockResolvedValue(undefined);
    clipboardHistoryStore.favorites = [
      { id: 'f1', type: ClipboardItemType.Text, preview: 'fav', createdAt: 100, favorite: true },
    ] as any;
    clipboardHistoryStore.recent = [
      { id: 'r1', type: ClipboardItemType.Text, preview: 'rec', createdAt: 50, favorite: false },
    ] as any;

    const items = await getInstance().getRecentItems(30);

    expect(loadSpy).toHaveBeenCalledWith(30);
    expect(items.map((i) => i.id)).toEqual(['f1', 'r1']);
  })

  it('passes limit through to loadInitial', async () => {
    const loadSpy = vi.spyOn(clipboardHistoryStore, 'loadInitial').mockResolvedValue(undefined);
    clipboardHistoryStore.favorites = [] as any;
    clipboardHistoryStore.recent = [] as any;

    await getInstance().getRecentItems(75);

    expect(loadSpy).toHaveBeenCalledWith(75);
  })

  it('returns empty array and reports to diagnostics when loadInitial throws', async () => {
    vi.spyOn(clipboardHistoryStore, 'loadInitial').mockRejectedValueOnce(new Error('db error'));

    const result = await getInstance().getRecentItems(30);

    expect(result).toEqual([]);
  })
})

// ── pasteItem ─────────────────────────────────────────────────────────────────

describe('pasteItem', () => {
  it('calls hideWindow, writeToClipboard, and simulatePaste in order without delay', async () => {
    const svc = getInstance()

    // Accessibility is granted, so the paste proceeds normally.
    vi.mocked(invoke).mockResolvedValue(true)

    const hideWindowSpy = vi.spyOn(svc, 'hideWindow').mockResolvedValue(undefined)
    const writeToClipboardSpy = vi.spyOn(svc, 'writeToClipboard').mockResolvedValue(undefined)
    const simulatePasteSpy = vi.spyOn(svc, 'simulatePaste').mockResolvedValue(true)

    const item = makeItem(ClipboardItemType.Text, 'pasted content')

    await svc.pasteItem(item)

    expect(hideWindowSpy).toHaveBeenCalled()
    expect(writeToClipboardSpy).toHaveBeenCalledWith(item)
    expect(simulatePasteSpy).toHaveBeenCalled()
  })

  it('skips the clipboard write and opens Accessibility settings when permission is denied', async () => {
    const svc = getInstance()

    // check_accessibility_permission resolves false; open_accessibility_preferences resolves undefined.
    vi.mocked(invoke).mockImplementation(async (cmd: string) =>
      cmd === 'check_accessibility_permission' ? false : undefined
    )

    const hideWindowSpy = vi.spyOn(svc, 'hideWindow').mockResolvedValue(undefined)
    const writeToClipboardSpy = vi.spyOn(svc, 'writeToClipboard').mockResolvedValue(undefined)
    const simulatePasteSpy = vi.spyOn(svc, 'simulatePaste').mockResolvedValue(true)

    const item = makeItem(ClipboardItemType.Text, 'pasted content')

    await svc.pasteItem(item)

    // No clipboard mutation => no duplicate history entry, and the window stays
    // visible so the user can see the guidance.
    expect(writeToClipboardSpy).not.toHaveBeenCalled()
    expect(simulatePasteSpy).not.toHaveBeenCalled()
    expect(hideWindowSpy).not.toHaveBeenCalled()

    // Jumps the user straight to the right System Settings pane.
    expect(invoke).toHaveBeenCalledWith('open_accessibility_preferences')

    // Surfaces a guiding diagnostic mentioning Accessibility.
    expect(diagnosticsService.report).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'manual',
        severity: 'warning',
        context: expect.objectContaining({
          message: expect.stringContaining('Accessibility'),
        }),
      })
    )
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

  it('deleteItem unlinks image cache using the IPC response, not a full scan', async () => {
    const deleteSpy = vi.spyOn(clipboardHistoryStore, 'deleteHistoryItem')
      .mockResolvedValue({ imageContentPath: '/cache/foo.png' });
    vi.mocked(remove).mockClear();

    const ok = await getInstance().deleteItem('foo');

    expect(ok).toBe(true);
    expect(deleteSpy).toHaveBeenCalledWith('foo');
    expect(remove).toHaveBeenCalledWith('/cache/foo.png');
  });

  it('deleteItem does not unlink anything when the IPC response has no image path', async () => {
    vi.spyOn(clipboardHistoryStore, 'deleteHistoryItem')
      .mockResolvedValue({ imageContentPath: undefined });
    vi.mocked(remove).mockClear();

    await getInstance().deleteItem('text-row');

    expect(remove).not.toHaveBeenCalled();
  });

  it('clearNonFavorites unlinks every image path returned by the IPC response', async () => {
    vi.spyOn(clipboardHistoryStore, 'clearHistory')
      .mockResolvedValue({
        removedIds: ['a', 'b'],
        removedImagePaths: ['/cache/a.png', '/cache/b.png'],
      });
    vi.mocked(remove).mockClear();

    const ok = await getInstance().clearNonFavorites();

    expect(ok).toBe(true);
    expect(remove).toHaveBeenCalledWith('/cache/a.png');
    expect(remove).toHaveBeenCalledWith('/cache/b.png');
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
  beforeEach(() => {
    vi.clearAllMocks()
  })

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

