import { describe, expect, it, vi } from 'vitest';
import { createRowThumbnailLoader } from './rowThumbnailLoader';

describe('row thumbnail loader', () => {
  it('deduplicates concurrent requests for the same file', async () => {
    let resolveIcon: (url: string | null) => void = () => {};
    const getIcon = vi.fn(
      () =>
        new Promise<string | null>((resolve) => {
          resolveIcon = resolve;
        }),
    );
    const loader = createRowThumbnailLoader({
      platform: 'macos',
      getThumbnail: vi.fn(),
      getIcon,
    });

    const first = loader.load('file-1', '/one/report.pdf', false, false);
    const second = loader.load('file-1', '/one/report.pdf', false, false);
    resolveIcon('asyar-thumb://localhost/pdf.png');

    await expect(first).resolves.toEqual({
      url: 'asyar-thumb://localhost/pdf.png',
      kind: 'icon',
    });
    await expect(second).resolves.toEqual({
      url: 'asyar-thumb://localhost/pdf.png',
      kind: 'icon',
    });
    expect(getIcon).toHaveBeenCalledOnce();
  });

  it('reuses resolved extension icons without another IPC call', async () => {
    const getIcon = vi.fn().mockResolvedValue('asyar-thumb://localhost/pdf.png');
    const loader = createRowThumbnailLoader({
      platform: 'windows',
      getThumbnail: vi.fn(),
      getIcon,
    });

    await loader.load('file-1', 'C:/one/report.PDF', false, false);
    await expect(loader.load('file-2', 'C:/two/other.pdf', false, false)).resolves.toEqual({
      url: 'asyar-thumb://localhost/pdf.png',
      kind: 'icon',
    });
    expect(getIcon).toHaveBeenCalledOnce();
  });

  it('does not share per-file or extensionless icons', async () => {
    const getIcon = vi.fn(async (path: string) => `icon:${path}`);
    const loader = createRowThumbnailLoader({
      platform: 'windows',
      getThumbnail: vi.fn(),
      getIcon,
    });

    await loader.load('exe-1', 'C:/one/chrome.exe', false, false);
    await loader.load('exe-2', 'C:/two/calc.exe', false, false);
    await loader.load('plain-1', '/one/Makefile', false, false);
    await loader.load('plain-2', '/two/Dockerfile', false, false);

    expect(getIcon).toHaveBeenCalledTimes(4);
  });

  it('skips unsupported native icon IPC on Linux', async () => {
    const getIcon = vi.fn();
    const loader = createRowThumbnailLoader({
      platform: 'other',
      getThumbnail: vi.fn(),
      getIcon,
    });

    await expect(loader.load('file-1', '/one/report.pdf', false, false)).resolves.toEqual({
      url: null,
      kind: 'icon',
    });
    expect(getIcon).not.toHaveBeenCalled();
  });

  it('marks an image fallback as a native icon', async () => {
    const loader = createRowThumbnailLoader({
      platform: 'macos',
      getThumbnail: vi.fn().mockResolvedValue(null),
      getIcon: vi.fn().mockResolvedValue('asyar-thumb://localhost/image-icon.png'),
    });

    await expect(loader.load('image-1', '/one/photo.png', true, false)).resolves.toEqual({
      url: 'asyar-thumb://localhost/image-icon.png',
      kind: 'icon',
    });
  });
});
