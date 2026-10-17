import type { HostPlatform } from '../../lib/keyboard/hostPlatform';

export type RowThumbnail = {
  url: string | null;
  kind: 'thumbnail' | 'icon';
};

type LoaderDependencies = {
  platform: HostPlatform;
  getThumbnail: (path: string, maxDim: number) => Promise<string | null>;
  getIcon: (path: string) => Promise<string | null>;
  thumbnailDimension?: number;
};

const PER_FILE_ICON_EXTENSIONS = new Set(['exe', 'lnk', 'ico', 'icns']);

function sharedIconExtension(path: string, isDir: boolean): string | null {
  if (isDir) return null;
  const name = path.replace(/\\/g, '/').split('/').pop() ?? '';
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return null;
  const extension = name.slice(dot + 1).toLowerCase();
  return PER_FILE_ICON_EXTENSIONS.has(extension) ? null : extension;
}

export function createRowThumbnailLoader({
  platform,
  getThumbnail,
  getIcon,
  thumbnailDimension = 56,
}: LoaderDependencies) {
  const inFlight = new Map<string, Promise<RowThumbnail>>();
  const extensionIconCache = new Map<string, string | null>();
  const extensionInFlight = new Map<string, Promise<string | null>>();

  async function loadIcon(path: string, isDir: boolean): Promise<string | null> {
    if (platform === 'other') return null;
    const extension = sharedIconExtension(path, isDir);
    if (!extension) return getIcon(path).catch(() => null);
    if (extensionIconCache.has(extension)) return extensionIconCache.get(extension) ?? null;

    const pending = extensionInFlight.get(extension);
    if (pending) return pending;

    const request = getIcon(path)
      .catch(() => null)
      .then((url) => {
        extensionIconCache.set(extension, url);
        return url;
      })
      .finally(() => extensionInFlight.delete(extension));
    extensionInFlight.set(extension, request);
    return request;
  }

  function load(
    fileId: string,
    path: string,
    isImage: boolean,
    isDir: boolean,
  ): Promise<RowThumbnail> {
    const pending = inFlight.get(fileId);
    if (pending) return pending;

    const request = (async (): Promise<RowThumbnail> => {
      if (isImage) {
        const thumbnail = await getThumbnail(path, thumbnailDimension).catch(() => null);
        if (thumbnail) return { url: thumbnail, kind: 'thumbnail' };
      }
      return { url: await loadIcon(path, isDir), kind: 'icon' };
    })().finally(() => inFlight.delete(fileId));

    inFlight.set(fileId, request);
    return request;
  }

  return {
    load,
    isInFlight: (fileId: string) => inFlight.has(fileId),
  };
}
