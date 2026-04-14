import { invoke } from '@tauri-apps/api/core'
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
    const version = await invoke<string | null>('app_updater_check_now')
    if (!version) {
      logService.info('updateService: no update available')
      return { kind: 'up-to-date' }
    }
    logService.info(`updateService: update ${version} downloaded`)
    return { kind: 'installed', version }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    logService.error(`updateService: check failed — ${message}`)
    return { kind: 'error', message }
  } finally {
    inFlight = false
  }
}
