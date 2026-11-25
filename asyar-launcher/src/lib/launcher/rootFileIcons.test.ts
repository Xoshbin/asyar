import { describe, expect, it, vi } from 'vitest';
import { createRootFileIconCache } from './rootFileIcons.svelte';

describe('root file icon cache', () => {
  it('requests an icon once per object id and never requests a content thumbnail', async () => {
    const getIcon = vi.fn().mockResolvedValue('asyar-thumb://localhost/native.png');
    const cache = createRootFileIconCache({ platform: 'macos', getIcon });
    const rows = [{ object_id: 'file_1', path: '/tmp/report.pdf' }];

    cache.request(rows);
    cache.request(rows);
    await vi.waitFor(() =>
      expect(cache.iconFor('file_1')).toBe('asyar-thumb://localhost/native.png'),
    );
    expect(getIcon).toHaveBeenCalledOnce();
  });

  it('ignores rows without a path', () => {
    const getIcon = vi.fn();
    const cache = createRootFileIconCache({
      platform: 'macos',
      getIcon,
    });
    cache.request([{ object_id: 'file_1' }]);
    expect(getIcon).not.toHaveBeenCalled();
  });

  it('uses the native icon for each path when a folder and a file share a suffix', async () => {
    const getIcon = vi.fn(async (path: string) =>
      path.endsWith('archive.pdf') ? 'folder-icon' : 'pdf-icon',
    );
    const cache = createRootFileIconCache({ platform: 'windows', getIcon });
    cache.request([
      { object_id: 'folder', path: 'C:/games/archive.pdf' },
      { object_id: 'document', path: 'C:/games/manual.pdf' },
    ]);
    await vi.waitFor(() => expect(cache.iconFor('document')).toBe('pdf-icon'));
    expect(cache.iconFor('folder')).toBe('folder-icon');
  });
});
