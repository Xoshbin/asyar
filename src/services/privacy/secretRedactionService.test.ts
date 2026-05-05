import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/ipc/commands', () => ({
  secretDetectionRedact: vi.fn(),
  secretDetectionGetSessionStats: vi.fn(),
  secretDetectionGetCatalog: vi.fn(),
}));

vi.mock('../log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const mockStore = {
  get: vi.fn(),
  set: vi.fn(),
  save: vi.fn(),
};

vi.mock('@tauri-apps/plugin-store', () => ({
  load: vi.fn(() => Promise.resolve(mockStore)),
}));

import {
  secretDetectionRedact,
  secretDetectionGetSessionStats,
  secretDetectionGetCatalog,
} from '../../lib/ipc/commands';
import { secretRedactionService } from './secretRedactionService.svelte';

describe('secretRedactionService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStore.get.mockResolvedValue(undefined);
    mockStore.set.mockResolvedValue(undefined);
    mockStore.save.mockResolvedValue(undefined);
    secretRedactionService.reset();
  });

  it('init loads catalog + stats + persisted settings', async () => {
    vi.mocked(secretDetectionGetCatalog).mockResolvedValueOnce([
      { kind: 'aws_access_key', description: 'AWS access key ID' },
    ]);
    vi.mocked(secretDetectionGetSessionStats).mockResolvedValueOnce({ aws_access_key: 1 });
    mockStore.get.mockResolvedValueOnce({
      master: true,
      clipboard: false,
      snippets: true,
      aiConversations: true,
    });

    await secretRedactionService.init();

    expect(secretRedactionService.catalog).toEqual([
      { kind: 'aws_access_key', description: 'AWS access key ID' },
    ]);
    expect(secretRedactionService.sessionStats.aws_access_key).toBe(1);
    expect(secretRedactionService.settings.clipboard).toBe(false);
  });

  it('init defaults to all-enabled when no persisted settings', async () => {
    vi.mocked(secretDetectionGetCatalog).mockResolvedValueOnce([]);
    vi.mocked(secretDetectionGetSessionStats).mockResolvedValueOnce({});
    mockStore.get.mockResolvedValueOnce(undefined);

    await secretRedactionService.init();

    expect(secretRedactionService.settings).toEqual({
      master: true,
      clipboard: true,
      snippets: true,
      aiConversations: true,
    });
  });

  it('redactIfEnabled returns null when master disabled', async () => {
    secretRedactionService.settings = {
      master: false,
      clipboard: true,
      snippets: true,
      aiConversations: true,
    };

    const r = await secretRedactionService.redactIfEnabled('clipboard', 'text=AKIA…');

    expect(r).toBeNull();
    expect(secretDetectionRedact).not.toHaveBeenCalled();
  });

  it('redactIfEnabled returns null when category disabled', async () => {
    secretRedactionService.settings = {
      master: true,
      clipboard: false,
      snippets: true,
      aiConversations: true,
    };

    const r = await secretRedactionService.redactIfEnabled('clipboard', 'text');

    expect(r).toBeNull();
    expect(secretDetectionRedact).not.toHaveBeenCalled();
  });

  it('redactIfEnabled calls Rust when both master and category enabled', async () => {
    secretRedactionService.settings = {
      master: true,
      clipboard: true,
      snippets: true,
      aiConversations: true,
    };
    vi.mocked(secretDetectionRedact).mockResolvedValueOnce({
      content: '[redacted: aws_access_key]',
      kinds: ['aws_access_key'],
      oversizedUnscanned: false,
    });

    const r = await secretRedactionService.redactIfEnabled('clipboard', 'AKIA…');

    expect(r?.kinds).toEqual(['aws_access_key']);
    expect(secretDetectionRedact).toHaveBeenCalledWith('AKIA…');
  });

  it('redactIfEnabled refreshes stats after a non-empty match', async () => {
    secretRedactionService.settings = {
      master: true,
      clipboard: true,
      snippets: true,
      aiConversations: true,
    };
    vi.mocked(secretDetectionRedact).mockResolvedValueOnce({
      content: '[redacted: aws_access_key]',
      kinds: ['aws_access_key'],
      oversizedUnscanned: false,
    });
    vi.mocked(secretDetectionGetSessionStats).mockResolvedValueOnce({
      aws_access_key: 1,
    });

    await secretRedactionService.redactIfEnabled('clipboard', 'AKIA…');

    expect(secretRedactionService.sessionStats.aws_access_key).toBe(1);
  });

  it('redactIfEnabled does not refresh stats when kinds empty', async () => {
    secretRedactionService.settings = {
      master: true,
      clipboard: true,
      snippets: true,
      aiConversations: true,
    };
    vi.mocked(secretDetectionRedact).mockResolvedValueOnce({
      content: 'plain',
      kinds: [],
      oversizedUnscanned: false,
    });

    await secretRedactionService.redactIfEnabled('clipboard', 'plain');

    expect(secretDetectionGetSessionStats).not.toHaveBeenCalled();
  });

  it('setMasterEnabled persists + updates state', async () => {
    secretRedactionService.settings = {
      master: true,
      clipboard: true,
      snippets: true,
      aiConversations: true,
    };

    await secretRedactionService.setMasterEnabled(false);

    expect(secretRedactionService.settings.master).toBe(false);
    expect(mockStore.set).toHaveBeenCalledWith(
      'settings',
      expect.objectContaining({ master: false }),
    );
    expect(mockStore.save).toHaveBeenCalled();
  });

  it('setCategoryEnabled persists + updates state', async () => {
    secretRedactionService.settings = {
      master: true,
      clipboard: true,
      snippets: true,
      aiConversations: true,
    };

    await secretRedactionService.setCategoryEnabled('clipboard', false);

    expect(secretRedactionService.settings.clipboard).toBe(false);
    expect(mockStore.set).toHaveBeenCalledWith(
      'settings',
      expect.objectContaining({ clipboard: false }),
    );
  });
});
