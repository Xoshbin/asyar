import { appUpdaterCheckNow } from '../../lib/ipc/updateCommands'
import { logService } from '../log/logService'

export type UpdateChannel = 'stable' | 'beta'

export type UpdateResult =
  | { kind: 'up-to-date' }
  | { kind: 'installed'; version: string }
  | { kind: 'error'; message: string }
  | { kind: 'busy' }

let inFlight = false

export function resetUpdateCheckState(): void {
  inFlight = false
}

export async function runUpdateCheck(): Promise<UpdateResult> {
  if (inFlight) {
    logService.debug('updateService: ignoring concurrent check request')
    return { kind: 'busy' }
  }

  inFlight = true
  logService.info('updateService: checking for updates')

  try {
    const result = await appUpdaterCheckNow()
    if (!result.ok) {
      const message = 'app_updater_check_now failed'
      logService.error(`updateService: check failed — ${message}`)
      return { kind: 'error', message }
    }
    if (!result.value) {
      logService.info('updateService: no update available')
      return { kind: 'up-to-date' }
    }
    logService.info(`updateService: update ${result.value} downloaded`)
    return { kind: 'installed', version: result.value }
  } finally {
    inFlight = false
  }
}
