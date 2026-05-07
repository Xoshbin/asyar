import { openUrl } from '../../lib/ipc/commands'

export class OpenerService {
  async open(url: string): Promise<void> {
    if (!url) return
    await openUrl(url)
  }
}

export const openerService = new OpenerService()
