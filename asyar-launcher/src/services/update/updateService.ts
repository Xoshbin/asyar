import { check } from '@tauri-apps/plugin-updater'
import { logService } from '../log/logService'

export type UpdateChannel = 'stable' | 'beta'

export type UpdateProgressPhase = 'available' | 'downloading'

export type UpdateResult =
  | { kind: 'up-to-date' }
  | { kind: 'installed'; version: string }
  | { kind: 'error'; message: string }
  | { kind: 'busy' }

export interface RunUpdateCheckOptions {
  onProgress?: (phase: UpdateProgressPhase, version: string) => void
}

let inFlight = false

export function resetUpdateCheckState(): void {
  inFlight = false
}

export async function runUpdateCheck(
  channel: UpdateChannel,
  options: RunUpdateCheckOptions = {},
): Promise<UpdateResult> {
  if (inFlight) {
    logService.debug('updateService: ignoring concurrent check request')
    return { kind: 'busy' }
  }

  inFlight = true
  logService.info(`updateService: checking for updates on channel=${channel}`)

  try {
    const update = await check({ headers: { 'X-Update-Channel': channel } })

    if (!update) {
      logService.info('updateService: no update available')
      return { kind: 'up-to-date' }
    }

    const { version } = update
    logService.info(`updateService: update ${version} available, downloading`)
    options.onProgress?.('available', version)
    options.onProgress?.('downloading', version)

    await update.downloadAndInstall()
    logService.info(`updateService: update ${version} installed`)
    return { kind: 'installed', version }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    logService.error(`updateService: check failed — ${message}`)
    return { kind: 'error', message }
  } finally {
    inFlight = false
  }
}
