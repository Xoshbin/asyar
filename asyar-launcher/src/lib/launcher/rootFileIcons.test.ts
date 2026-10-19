import { describe, expect, it, vi } from 'vitest';
import { createRootFileIconCache } from './rootFileIcons.svelte';

describe('root file icon cache', () => {
  it('requests an icon once per object id and never requests a content thumbnail', async () => {
    const getIcon = vi.fn().mockResolvedValue('asyar-thumb://localhost/native.png');
    const getThumbnail = vi.fn();
    const cache = createRootFileIconCache({ platform: 'macos', getIcon, getThumbnail });
    const rows = [{ object_id: 'file_1', path: '/tmp/report.pdf' }];

    cache.request(rows);
    cache.request(rows);
    await vi.waitFor(() =>
      expect(cache.iconFor('file_1')).toBe('asyar-thumb://localhost/native.png'),
    );
    expect(getIcon).toHaveBeenCalledOnce();
    expect(getThumbnail).not.toHaveBeenCalled();
  });

  it('ignores rows without a path', () => {
    const getIcon = vi.fn();
    const cache = createRootFileIconCache({
      platform: 'macos',
      getIcon,
      getThumbnail: vi.fn(),
    });
    cache.request([{ object_id: 'file_1' }]);
    expect(getIcon).not.toHaveBeenCalled();
  });
});
