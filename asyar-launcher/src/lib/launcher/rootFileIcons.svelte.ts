import { getFileIcon } from '../ipc/thumbnailCommands';
import { getHostPlatform, type HostPlatform } from '../keyboard/hostPlatform';

type Dependencies = {
  platform: HostPlatform;
  getIcon: typeof getFileIcon;
};

export function createRootFileIconCache(
  dependencies: Dependencies = {
    platform: getHostPlatform(),
    getIcon: getFileIcon,
  },
): {
  iconFor(objectId: string): string | undefined;
  request(rows: Array<{ object_id: string; path?: string }>): void;
} {
  let icons = $state<Record<string, string>>({});
  const requested = new Set<string>();

  return {
    iconFor(objectId) {
      return icons[objectId];
    },
    request(rows) {
      if (dependencies.platform === 'other') return;
      for (const row of rows) {
        if (!row.path || requested.has(row.object_id)) continue;
        requested.add(row.object_id);
        // The native cache knows whether this path is a file or a directory.
        void dependencies
          .getIcon(row.path)
          .then((url) => {
            if (url) icons = { ...icons, [row.object_id]: url };
          })
          .catch(() => {});
      }
    },
  };
}
