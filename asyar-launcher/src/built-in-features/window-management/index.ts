import { logService } from '../../services/log/logService'
import { windowManagementService } from '../../services/windowManagement/windowManagementService'
import { feedbackService } from '../../services/feedback/feedbackService.svelte'
import { diagnosticsService } from '../../services/diagnostics/diagnosticsService.svelte'
import { actionService } from '../../services/action/actionService.svelte'
import { windowManagementState } from './state.svelte'
import { getPresetBounds, PRESET_IDS } from './presets'
import ManageView from './ManageView.svelte'
import {
  type Extension,
  type ExtensionContext,
  type ExtensionResult,
  type IStorageService,
  type IExtensionManager,
  ActionContext,
} from 'asyar-sdk/contracts'

class WindowManagementExtension implements Extension {
  onUnload: any

  private store?: IStorageService
  private extensionManager?: IExtensionManager
  private inView = false

  async initialize(context: ExtensionContext): Promise<void> {
    this.store = context.getService<IStorageService>('storage')
    this.extensionManager = context.getService<IExtensionManager>('extensions')
    if (this.store) {
      await windowManagementState.loadFromStorage(this.store)
    }
    logService.info('[WindowManagement] Initialized')
  }

  async executeCommand(commandId: string, _args?: Record<string, any>): Promise<any> {
    if (commandId === 'restore') {
      return this.restorePreviousBounds()
    }

    if (commandId === 'manage-layouts') {
      this.extensionManager?.navigateToView('window-management/ManageView')
      return { type: 'view', viewPath: 'window-management/ManageView' }
    }

    if ((PRESET_IDS as readonly string[]).includes(commandId)) {
      return this.applyPreset(commandId)
    }

    logService.warn(`[WindowManagement] Unknown command: ${commandId}`)
  }

  private async applyPreset(presetId: string): Promise<void> {
    const sw = window.screen.availWidth
    const sh = window.screen.availHeight
    const preset = getPresetBounds(presetId, sw, sh)
    if (!preset) return

    try {
      const current = await windowManagementService.getWindowBounds()
      if (this.store) {
        await windowManagementState.savePreviousBounds(current, this.store)
      }

      if (preset.fullscreen) {
        await windowManagementService.setFullscreen(true)
      } else if (preset.bounds) {
        await windowManagementService.setWindowBounds(preset.bounds)
      }

      const label = presetId
        .split('-')
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ')
      await feedbackService.showHUD(label)
    } catch (err: any) {
      logService.error(`[WindowManagement] applyPreset failed: ${err}`)
      await diagnosticsService.report({
        source: 'frontend',
        kind: 'manual',
        severity: 'error',
        retryable: false,
        context: { message: `Could not apply layout${err.message ? ' — ' + err.message : ''}` },
      })
    }
  }

  private async restorePreviousBounds(): Promise<void> {
    const prev = windowManagementState.previousBounds
    if (!prev) {
      await diagnosticsService.report({
        source: 'frontend',
        kind: 'manual',
        severity: 'error',
        retryable: false,
        context: { message: 'Nothing to restore' },
      })
      return
    }
    try {
      await windowManagementService.setWindowBounds(prev)
      await feedbackService.showHUD('Restored')
    } catch (err: any) {
      await diagnosticsService.report({
        source: 'frontend',
        kind: 'manual',
        severity: 'error',
        retryable: false,
        context: { message: `Restore failed${err.message ? ' — ' + err.message : ''}` },
      })
    }
  }

  async search(query: string): Promise<ExtensionResult[]> {
    const { customLayouts } = windowManagementState
    if (!customLayouts.length) return []

    const q = query.toLowerCase()
    const matched = customLayouts.filter(l => l.name.toLowerCase().includes(q))

    return matched.map(layout => ({
      title: layout.name,
      subtitle: `${Math.round(layout.bounds.width)}x${Math.round(layout.bounds.height)} at (${Math.round(layout.bounds.x)}, ${Math.round(layout.bounds.y)})`,
      score: 0.7,
      type: 'result' as const,
      icon: 'icon:store',
      action: () => this.applyCustomLayout(layout),
    }))
  }

  private async applyCustomLayout(layout: import('./state.svelte').CustomLayout): Promise<void> {
    try {
      const current = await windowManagementService.getWindowBounds()
      if (this.store) {
        await windowManagementState.savePreviousBounds(current, this.store)
      }
      await windowManagementService.setWindowBounds(layout.bounds)
      await feedbackService.showHUD(layout.name)
    } catch (err: any) {
      await diagnosticsService.report({
        source: 'frontend',
        kind: 'manual',
        severity: 'error',
        retryable: false,
        context: { message: `Could not apply layout${err.message ? ' — ' + err.message : ''}` },
      })
    }
  }

  async viewActivated(viewPath: string): Promise<void> {
    this.inView = true
    this.registerManageActions()
    logService.debug(`[WindowManagement] View activated: ${viewPath}`)
  }

  async viewDeactivated(viewPath: string): Promise<void> {
    this.inView = false
    this.unregisterManageActions()
    logService.debug(`[WindowManagement] View deactivated: ${viewPath}`)
  }

  private registerManageActions(): void {
    actionService.registerAction({
      id: 'window-management:save-current-window',
      title: 'Save Current Window as Layout',
      description: 'Capture the frontmost window position and size as a custom layout',
      icon: 'icon:plus',
      extensionId: 'window-management',
      category: 'window-management',
      context: ActionContext.EXTENSION_VIEW,
      execute: () => this.saveCurrentWindowLayout(),
    })
  }

  private unregisterManageActions(): void {
    actionService.unregisterAction('window-management:save-current-window')
  }

  private async saveCurrentWindowLayout(): Promise<void> {
    if (!this.store) return
    try {
      const bounds = await windowManagementService.getWindowBounds()
      const name = `${Math.round(bounds.width)}x${Math.round(bounds.height)}`
      await windowManagementState.addCustomLayout(name, bounds, this.store)
      await feedbackService.showHUD(`Saved "${name}"`)
    } catch (err: any) {
      await diagnosticsService.report({
        source: 'frontend',
        kind: 'manual',
        severity: 'error',
        retryable: false,
        context: { message: `Could not save layout${err.message ? ' — ' + err.message : ''}` },
      })
    }
  }

  async activate(): Promise<void> {}
  async deactivate(): Promise<void> {
    if (this.inView) this.unregisterManageActions()
  }
}

export default new WindowManagementExtension()
export { ManageView }
