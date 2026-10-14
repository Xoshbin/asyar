import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/ipc/commands', () => ({
  openerPathPreview: vi.fn(),
  hideWindow: vi.fn(),
  openUrl: vi.fn(),
}));
vi.mock('../../services/opener/openerService', () => ({
  openerService: { openPath: vi.fn() },
}));
vi.mock('../../services/feedback/feedbackService.svelte', () => ({
  feedbackService: { report: vi.fn(), sendBackground: vi.fn() },
}));

import {
  openTarget,
  openTypedPath,
  openTypedUrl,
  OPEN_PATH_ROW_ID,
  parseTarget,
  searchOpenTargets,
} from './openTarget';
import { hideWindow, openUrl, openerPathPreview } from '../../lib/ipc/commands';
import { openerService } from '../../services/opener/openerService';
import { feedbackService } from '../../services/feedback/feedbackService.svelte';

const coding = {
  path: '/Users/me/coding',
  name: 'coding',
  parent: '~',
  icon: 'asyar-icon://localhost/x.png',
};

describe('parseTarget', () => {
  it.each([
    ['https://example.com/a?b=1', 'https://example.com/a?b=1'],
    ['github.com', 'https://github.com'],
    ['sub.example.co.uk/path', 'https://sub.example.co.uk/path'],
    ['localhost:3000', 'http://localhost:3000'],
    ['192.168.1.1:8080', 'http://192.168.1.1:8080'],
    ['mailto:a@b.com', 'mailto:a@b.com'],
  ])('%s -> url %s', (q, url) => {
    expect(parseTarget(q)).toEqual({ kind: 'url', url });
  });

  it.each(['~', '~/Downloads', '~\\Documents', '/etc/hosts', 'C:\\Users', '/Users/me/My Files'])(
    '%s -> path',
    (q) => {
      expect(parseTarget(q)).toEqual({ kind: 'path', path: q });
    },
  );

  it.each(['', 'safari', '1.5', '2+2', 'hello world', '~foo', 'javascript:alert(1)'])(
    'ignores %s',
    (q) => {
      expect(parseTarget(q)).toBeNull();
    },
  );
});

describe('root-search rows', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders paths like Finder rows and drops missing ones', async () => {
    vi.mocked(openerPathPreview).mockResolvedValueOnce(coding);
    const [row] = await searchOpenTargets('~/coding');
    expect(openerPathPreview).toHaveBeenCalledWith('~/coding');
    expect(row).toMatchObject({
      id: OPEN_PATH_ROW_ID,
      title: 'coding',
      subtitle: '~',
      icon: coding.icon,
      actionPayload: { kind: 'path', path: coding.path },
    });

    vi.mocked(openerPathPreview).mockResolvedValueOnce(null);
    expect(await searchOpenTargets('/nope')).toEqual([]);
  });

  it('opens urls and paths, then hides the window', async () => {
    await openTarget({ kind: 'url', url: 'https://github.com' });
    expect(openUrl).toHaveBeenCalledWith('https://github.com');
    await openTarget({ kind: 'path', path: '/etc/hosts' });
    expect(openerService.openPath).toHaveBeenCalledWith(null, '/etc/hosts');
    expect(hideWindow).toHaveBeenCalledTimes(2);
  });
});

describe('Open URL / Open Path commands', () => {
  beforeEach(() => vi.clearAllMocks());

  it('Open URL adds https:// to bare input', async () => {
    await openTypedUrl('example');
    expect(openUrl).toHaveBeenCalledWith('https://example');
    await openTypedUrl('localhost:5173');
    expect(openUrl).toHaveBeenCalledWith('http://localhost:5173');
  });

  it('Open Path opens the resolved path, or reports a missing one', async () => {
    vi.mocked(openerPathPreview).mockResolvedValueOnce(coding);
    await openTypedPath('~/coding');
    expect(openerService.openPath).toHaveBeenCalledWith(null, coding.path);

    vi.mocked(openerPathPreview).mockResolvedValueOnce(null);
    await openTypedPath('~/nope');
    expect(openerService.openPath).toHaveBeenCalledTimes(1);
    expect(feedbackService.sendBackground).toHaveBeenCalledWith({
      title: 'Open Path',
      body: 'Not found: ~/nope',
    });
  });
});
