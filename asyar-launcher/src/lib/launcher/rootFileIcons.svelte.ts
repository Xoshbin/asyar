import { createRowThumbnailLoader } from '../../built-in-features/file-search/rowThumbnailLoader';
import { getFileIcon, getFileThumbnail } from '../ipc/thumbnailCommands';
import { getHostPlatform, type HostPlatform } from '../keyboard/hostPlatform';

type Dependencies = {
  platform: HostPlatform;
  getIcon: typeof getFileIcon;
  getThumbnail: typeof getFileThumbnail;
};

export function createRootFileIconCache(
  dependencies: Dependencies = {
    platform: getHostPlatform(),
    getIcon: getFileIcon,
    getThumbnail: getFileThumbnail,
  },
): {
  iconFor(objectId: string): string | undefined;
  request(rows: Array<{ object_id: string; path?: string }>): void;
} {
  let icons = $state<Record<string, string>>({});
  const requested = new Set<string>();
  const loader = createRowThumbnailLoader({
    platform: dependencies.platform,
    getIcon: dependencies.getIcon,
    getThumbnail: dependencies.getThumbnail,
    thumbnailDimension: 56,
  });

  return {
    iconFor(objectId) {
      return icons[objectId];
    },
    request(rows) {
      for (const row of rows) {
        if (!row.path || requested.has(row.object_id)) continue;
        requested.add(row.object_id);
        void loader.load(row.object_id, row.path, false, false).then(({ url }) => {
          if (url) icons = { ...icons, [row.object_id]: url };
        });
      }
    },
  };
}
