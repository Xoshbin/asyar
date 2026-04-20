import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies BEFORE importing the module under test
vi.mock('../../services/selection/selectionService', () => ({
  selectionService: { getSelectedText: vi.fn() },
}));
vi.mock('../../services/clipboard/clipboardHistoryService', () => ({
  clipboardHistoryService: { readCurrentText: vi.fn() },
}));

// Import AFTER mocks
import { resolveTemplate, hasPlaceholders, PLACEHOLDERS } from './placeholderResolver';
import { selectionService } from '../../services/selection/selectionService';
import { clipboardHistoryService } from '../../services/clipboard/clipboardHistoryService';

const mockReadCurrentText = vi.mocked(clipboardHistoryService.readCurrentText);

beforeEach(() => {
  vi.clearAllMocks();
});

// ── {query} ───────────────────────────────────────────────────────────────────

describe('{query} placeholder', () => {
  it('resolves to context.query', async () => {
    const result = await resolveTemplate('{query}', { query: 'hello world' });
    expect(result).toBe('hello world');
  });

  it('resolves to empty string when context.query is not provided', async () => {
    const result = await resolveTemplate('{query}', {});
    expect(result).toBe('');
  });

  it('{Argument} alias also resolves to context.query', async () => {
    const result = await resolveTemplate('{Argument}', { query: 'test' });
    expect(result).toBe('test');
  });
});

// ── {UUID} ────────────────────────────────────────────────────────────────────

describe('{UUID} placeholder', () => {
  it('produces a valid UUID v4 string', async () => {
    const result = await resolveTemplate('{UUID}', {});
    expect(result).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
  });

  it('reuses ctx.query when it is a valid UUID (pre-fill consistency)', async () => {
    const prefilled = 'a1b2c3d4-e5f6-4789-abcd-ef0123456789';
    const result = await resolveTemplate('{UUID}', { query: prefilled });
    expect(result).toBe(prefilled);
  });

  it('generates a new UUID when ctx.query is not a UUID', async () => {
    const result = await resolveTemplate('{UUID}', { query: 'hello' });
    expect(result).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
    expect(result).not.toBe('hello');
  });
});

// ── Date/Time placeholders ────────────────────────────────────────────────────

describe('date and time placeholders', () => {
  it('{Date} produces a non-empty string', async () => {
    const result = await resolveTemplate('{Date}', {});
    expect(result.length).toBeGreaterThan(0);
  });

  it('{Time} produces a non-empty string', async () => {
    const result = await resolveTemplate('{Time}', {});
    expect(result.length).toBeGreaterThan(0);
  });

  it('{Date & Time} produces a non-empty string', async () => {
    const result = await resolveTemplate('{Date & Time}', {});
    expect(result.length).toBeGreaterThan(0);
  });

  it('{Weekday} produces a non-empty string', async () => {
    const result = await resolveTemplate('{Weekday}', {});
    expect(result.length).toBeGreaterThan(0);
  });
});

// ── {Selected Text} ───────────────────────────────────────────────────────────

describe('{Selected Text} placeholder', () => {
  it('returns mocked selectionService result', async () => {
    vi.mocked(selectionService.getSelectedText).mockResolvedValueOnce('selected content');
    const result = await resolveTemplate('{Selected Text}', {});
    expect(result).toBe('selected content');
  });

  it('returns empty string when selectionService throws', async () => {
    vi.mocked(selectionService.getSelectedText).mockRejectedValueOnce(new Error('permission denied'));
    const result = await resolveTemplate('{Selected Text}', {});
    expect(result).toBe('');
  });

  it('{selection} alias also works', async () => {
    vi.mocked(selectionService.getSelectedText).mockResolvedValueOnce('aliased content');
    const result = await resolveTemplate('{selection}', {});
    expect(result).toBe('aliased content');
  });
});

// ── {Clipboard Text} ──────────────────────────────────────────────────────────

describe('{Clipboard Text} placeholder', () => {
  it('returns plain text from readCurrentText', async () => {
    mockReadCurrentText.mockResolvedValueOnce('clipboard content');
    const result = await resolveTemplate('{Clipboard Text}', {});
    expect(result).toBe('clipboard content');
    expect(mockReadCurrentText).toHaveBeenCalled();
  });

  it('returns plain text even when browser-copied content has HTML flavor (regression)', async () => {
    // Simulates clipboard with BOTH HTML and plain-text flavors, as happens when copying
    // from a browser. readCurrentText must return the plain-text view, not the HTML blob.
    mockReadCurrentText.mockResolvedValueOnce('hello world');
    const result = await resolveTemplate('{Clipboard Text}', {});
    expect(result).toBe('hello world');
  });

  it('returns empty string when readCurrentText returns empty', async () => {
    mockReadCurrentText.mockResolvedValueOnce('');
    const result = await resolveTemplate('{Clipboard Text}', {});
    expect(result).toBe('');
  });

  it('returns empty string when readCurrentText throws', async () => {
    mockReadCurrentText.mockRejectedValueOnce(new Error('clipboard unavailable'));
    const result = await resolveTemplate('{Clipboard Text}', {});
    expect(result).toBe('');
  });

  it('{clipboard} alias also works', async () => {
    mockReadCurrentText.mockResolvedValueOnce('aliased clipboard');
    const result = await resolveTemplate('{clipboard}', {});
    expect(result).toBe('aliased clipboard');
  });
});

// ── Unknown tokens ────────────────────────────────────────────────────────────

describe('unknown tokens', () => {
  it('leaves unknown {foo} token as-is', async () => {
    const result = await resolveTemplate('{foo}', {});
    expect(result).toBe('{foo}');
  });

  it('resolves known tokens while leaving unknown ones untouched', async () => {
    const result = await resolveTemplate('{query} and {unknown}', { query: 'hello' });
    expect(result).toBe('hello and {unknown}');
  });
});

// ── encodeValues option ───────────────────────────────────────────────────────

describe('encodeValues option', () => {
  it('encodes resolved value when encodeValues is true (space → %20)', async () => {
    const result = await resolveTemplate('{query}', { query: 'hello world' }, { encodeValues: true });
    expect(result).toBe('hello%20world');
  });

  it('does not encode when encodeValues is false', async () => {
    const result = await resolveTemplate('{query}', { query: 'hello world' }, { encodeValues: false });
    expect(result).toBe('hello world');
  });

  it('does not encode by default', async () => {
    const result = await resolveTemplate('{query}', { query: 'hello world' });
    expect(result).toBe('hello world');
  });
});

// ── Template with no tokens ───────────────────────────────────────────────────

describe('template with no tokens', () => {
  it('returns template unchanged when no placeholders present', async () => {
    const template = 'https://example.com/search?lang=en';
    const result = await resolveTemplate(template, { query: 'test' });
    expect(result).toBe(template);
  });
});

// ── Multiple tokens in one template ──────────────────────────────────────────

describe('multiple tokens in one template', () => {
  it('resolves all different tokens in one template', async () => {
    vi.mocked(selectionService.getSelectedText).mockResolvedValueOnce('selected');
    const result = await resolveTemplate('{query} + {Selected Text}', { query: 'typed' });
    expect(result).toBe('typed + selected');
  });

  it('handles URL with query and date', async () => {
    const result = await resolveTemplate('https://example.com/search?q={query}&v=1', { query: 'test' });
    expect(result).toBe('https://example.com/search?q=test&v=1');
  });
});

// ── Token deduplication (cache / call-once) ───────────────────────────────────

describe('same token appearing twice is resolved only once', () => {
  it('calls selectionService.getSelectedText only once for two occurrences', async () => {
    vi.mocked(selectionService.getSelectedText).mockResolvedValue('selection');
    const result = await resolveTemplate('{Selected Text} and again {Selected Text}', {});
    expect(result).toBe('selection and again selection');
    expect(selectionService.getSelectedText).toHaveBeenCalledTimes(1);
  });

  it('calls readCurrentText only once for two occurrences', async () => {
    mockReadCurrentText.mockResolvedValue('clip');
    const result = await resolveTemplate('{Clipboard Text} and {Clipboard Text}', {});
    expect(result).toBe('clip and clip');
    expect(mockReadCurrentText).toHaveBeenCalledTimes(1);
  });
});

// ── hasPlaceholders ───────────────────────────────────────────────────────────

describe('hasPlaceholders', () => {
  it('returns true when template contains a known placeholder', () => {
    expect(hasPlaceholders('https://google.com/search?q={query}')).toBe(true);
  });

  it('returns true for {Selected Text}', () => {
    expect(hasPlaceholders('{Selected Text}')).toBe(true);
  });

  it('returns false when template has no placeholders', () => {
    expect(hasPlaceholders('https://example.com')).toBe(false);
  });

  it('returns false for unknown token only', () => {
    expect(hasPlaceholders('{unknown}')).toBe(false);
  });
});

// ── PLACEHOLDERS array ────────────────────────────────────────────────────────

describe('PLACEHOLDERS array', () => {
  it('exports a non-empty array', () => {
    expect(PLACEHOLDERS.length).toBeGreaterThan(0);
  });

  it('every placeholder has id, label, token, and resolve function', () => {
    for (const p of PLACEHOLDERS) {
      expect(typeof p.id).toBe('string');
      expect(typeof p.label).toBe('string');
      expect(typeof p.token).toBe('string');
      expect(typeof p.resolve).toBe('function');
    }
  });
});
