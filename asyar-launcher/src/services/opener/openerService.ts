import { openUrl } from '../../lib/ipc/commands'
import { envService } from '../envService'
import { logService } from '../log/logService'

export class OpenerService {
  async open(url: string): Promise<void> {
    if (!url) return
    if (envService.isTauri) {
      await openUrl(url)
    } else {
      logService.info(`[OpenerService] Opening URL in browser mode: ${url}`)
      globalThis.open(url, '_blank')
    }
  }
}
