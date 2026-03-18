import * as os from 'os'
import * as path from 'path'

export function getExtensionsDir(): string {
  switch (process.platform) {
    case 'darwin':
      return path.join(
        os.homedir(),
        'Library', 'Application Support',
        'org.asyar.app', 'extensions'
      )
    case 'win32':
      return path.join(
        process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'),
        'org.asyar.app', 'extensions'
      )
    default: // linux — respects XDG_DATA_HOME
      return path.join(
        process.env.XDG_DATA_HOME ?? path.join(os.homedir(), '.local', 'share'),
        'org.asyar.app', 'extensions'
      )
  }
}
