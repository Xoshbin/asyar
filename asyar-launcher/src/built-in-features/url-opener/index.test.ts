import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('tauri-plugin-clipboard-x-api', () => ({ writeText: vi.fn() }));
vi.mock('../../services/log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../services/opener/openerService', () => ({
  openerService: { open: vi.fn() },
}));
vi.mock('../../lib/ipc/commands', () => ({ hideWindow: vi.fn() }));
vi.mock('../../services/feedback/feedbackService.svelte', () => ({
  feedbackService: { report: vi.fn(), showHUD: vi.fn() },
}));

import './index';
import {
  executeBuiltinSearchResult,
  getBuiltinRowActions,
  searchBuiltinProviders,
} from '../../services/search/builtinSearchProviders';
import { openerService } from '../../services/opener/openerService';
import { hideWindow } from '../../lib/ipc/commands';
import { feedbackService } from '../../services/feedback/feedbackService.svelte';
import { writeText } from 'tauri-plugin-clipboard-x-api';

const ROW_ID = 'url_opener_open';

describe('url-opener built-in', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns one top row for a URL', async () => {
    const hits = await searchBuiltinProviders('github.com/x', () => true);
    const mine = hits.filter((h) => h.extensionId === 'url-opener');
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({
      id: ROW_ID,
      title: 'Open in Browser',
      subtitle: 'https://github.com/x',
      icon: 'icon:globe',
      priority: 'top',
      primaryActionLabel: 'Open',
      actionPayload: { url: 'https://github.com/x' },
    });
  });

  it('returns nothing for non-URLs', async () => {
    for (const q of ['index.ts', 'safari']) {
      const hits = await searchBuiltinProviders(q, () => true);
      expect(hits.filter((h) => h.extensionId === 'url-opener')).toEqual([]);
    }
  });

  it('is skipped when the built-in is disabled', async () => {
    const hits = await searchBuiltinProviders('github.com', (id) => id !== 'url-opener');
    expect(hits.filter((h) => h.extensionId === 'url-opener')).toEqual([]);
  });

  it('opens with the host opener and hides the launcher', async () => {
    await executeBuiltinSearchResult('url-opener', ROW_ID, { url: 'https://a.com' });
    expect(openerService.open).toHaveBeenCalledWith(null, 'https://a.com');
    expect(hideWindow).toHaveBeenCalledTimes(1);
  });

  it('reports a failed open and keeps the launcher visible', async () => {
    vi.mocked(openerService.open).mockRejectedValueOnce(new Error('boom'));
    await executeBuiltinSearchResult('url-opener', ROW_ID, { url: 'https://a.com' });
    expect(feedbackService.report).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'frontend', severity: 'error' }),
    );
    expect(hideWindow).not.toHaveBeenCalled();
  });

  it('offers Copy URL in the action panel', async () => {
    const actions = getBuiltinRowActions('url-opener', ROW_ID, { url: 'https://a.com' });
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ id: 'url-opener:copy-url', label: 'Copy URL' });
    await actions[0].execute();
    expect(writeText).toHaveBeenCalledWith('https://a.com');
    expect(feedbackService.showHUD).toHaveBeenCalledWith('Copied URL');
  });

  it('ignores a malformed payload', async () => {
    await executeBuiltinSearchResult('url-opener', ROW_ID, { url: 42 });
    expect(openerService.open).not.toHaveBeenCalled();
    expect(getBuiltinRowActions('url-opener', ROW_ID, { url: 42 })).toEqual([]);
  });
});
