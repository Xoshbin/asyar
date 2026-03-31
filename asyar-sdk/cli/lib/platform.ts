import * as os from 'os'
import * as path from 'path'

export function getExtensionsDir(): string {
  return path.join(getAppDataDir(), 'extensions')
}

export function getAppDataDir(): string {
  switch (process.platform) {
    case 'darwin':
      return path.join(
        os.homedir(),
        'Library', 'Application Support',
        'org.asyar.app'
      )
    case 'win32':
      return path.join(
        process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'),
        'org.asyar.app'
      )
    default: // linux — respects XDG_DATA_HOME
      return path.join(
        process.env.XDG_DATA_HOME ?? path.join(os.homedir(), '.local', 'share'),
        'org.asyar.app'
      )
  }
}

export function getDevExtensionsFile(): string {
  return path.join(getAppDataDir(), 'dev_extensions.json')
}
