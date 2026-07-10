import * as os from 'os';
import * as path from 'path';

export function getExtensionsDir(isDevFlavor = false): string {
  return path.join(getAppDataDir(isDevFlavor), 'extensions');
}

export function getAppDataDir(isDevFlavor = false): string {
  const bundleId = isDevFlavor ? 'org.asyar.dev' : 'org.asyar.app';
  switch (process.platform) {
    case 'darwin':
      return path.join(os.homedir(), 'Library', 'Application Support', bundleId);
    case 'win32':
      return path.join(
        process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'),
        bundleId,
      );
    default: // linux — respects XDG_DATA_HOME
      return path.join(
        process.env.XDG_DATA_HOME ?? path.join(os.homedir(), '.local', 'share'),
        bundleId,
      );
  }
}

export function getDevExtensionsFile(isDevFlavor = false): string {
  return path.join(getAppDataDir(isDevFlavor), 'dev_extensions.json');
}
