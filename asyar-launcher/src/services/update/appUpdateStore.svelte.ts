import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { logService } from '../log/logService'

export type AppUpdatePhase = 'idle' | 'checking' | 'downloading' | 'ready' | 'error'

// Svelte 5 class-based reactive state — $state is only valid as a class field or
// variable declaration initializer, not inside an object literal.
class AppUpdateStore {
  phase = $state<AppUpdatePhase>('idle')
  pendingVersion = $state<string | null>(null)
  errorMessage = $state<string | null>(null)
}

export const appUpdateState = new AppUpdateStore()

let unlisteners: UnlistenFn[] = []
let initialized = false

export async function initAppUpdateStore(): Promise<void> {
  if (initialized) return
  initialized = true

  // Restore state from Rust in case a download completed before the webview loaded
  try {
    const pending = await invoke<{ version: string } | null>('app_updater_get_pending')
    if (pending) {
      appUpdateState.phase = 'ready'
      appUpdateState.pendingVersion = pending.version
    }
  } catch (e) {
    logService.warn(`appUpdateStore: failed to get pending update — ${e}`)
  }

  // Listen to Rust-emitted events
  const checking = await listen('asyar:app-update:checking', () => {
    appUpdateState.phase = 'checking'
    appUpdateState.errorMessage = null
  })

  const idle = await listen('asyar:app-update:idle', () => {
    appUpdateState.phase = 'idle'
  })

  const downloading = await listen<{ version: string }>('asyar:app-update:downloading', (e) => {
    appUpdateState.phase = 'downloading'
    appUpdateState.pendingVersion = e.payload.version
  })

  const ready = await listen<{ version: string }>('asyar:app-update:ready', (e) => {
    appUpdateState.phase = 'ready'
    appUpdateState.pendingVersion = e.payload.version
    logService.info(`appUpdateStore: update ${e.payload.version} ready, will apply on next launch`)
  })

  const error = await listen<{ message: string }>('asyar:app-update:error', (e) => {
    appUpdateState.phase = 'error'
    appUpdateState.errorMessage = e.payload.message
    logService.warn(`appUpdateStore: auto-check error — ${e.payload.message}`)
  })

  unlisteners = [checking, idle, downloading, ready, error]
}

export function destroyAppUpdateStore(): void {
  for (const unlisten of unlisteners) unlisten()
  unlisteners = []
  initialized = false
  appUpdateState.phase = 'idle'
  appUpdateState.pendingVersion = null
  appUpdateState.errorMessage = null
}
