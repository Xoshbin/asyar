import { logService } from '../../services/log/logService';
import { windowManagementService } from '../../services/windowManagement/windowManagementService';
import { feedbackService } from '../../services/feedback/feedbackService.svelte';
import { actionService } from '../../services/action/actionService.svelte';
import { windowManagementState } from './state.svelte';
import { getPresetBounds, PRESET_IDS } from './presets';
import { applyCustomLayout, syncLayoutToIndex, removeLayoutFromIndex } from './layoutLifecycle';
import { isAnyModalOpen } from '../../components/base/Modal.logic';
import ManageView from './ManageView.svelte';
import {
  type Extension,
  type ExtensionContext,
  type ExtensionResult,
  type IStorageService,
  type IExtensionManager,
  ActionContext,
} from 'asyar-sdk/contracts';

class WindowManagementExtension implements Extension {
  onUnload: any;

  private store?: IStorageService;
  private extensionManager?: IExtensionManager;
  private inView = false;

  async initialize(context: ExtensionContext): Promise<void> {
    this.store = context.getService<IStorageService>('storage');
    this.extensionManager = context.getService<IExtensionManager>('extensions');
    if (this.store) {
      windowManagementState.setStore(this.store);
      await windowManagementState.loadFromStorage(this.store);
      for (const layout of windowManagementState.customLayouts) {
        await syncLayoutToIndex(layout, this.store);
      }
    }
    logService.info('[WindowManagement] Initialized');
  }

  async executeCommand(commandId: string, _args?: Record<string, any>): Promise<any> {
    if (commandId === 'restore') {
      await this.restorePreviousBounds();
      return { type: 'no-view' };
    }

    if (commandId === 'manage-layouts') {
      this.extensionManager?.navigateToView('window-management/ManageView');
      return { type: 'view', viewPath: 'window-management/ManageView' };
    }

    if (commandId === 'save-current-layout') {
      await this.saveCurrentWindowLayout();
      return { type: 'no-view' };
    }

    if ((PRESET_IDS as readonly string[]).includes(commandId)) {
      await this.applyPreset(commandId);
      return { type: 'no-view' };
    }

    logService.warn(`[WindowManagement] Unknown command: ${commandId}`);
    return { type: 'no-view' };
  }

  private async applyPreset(presetId: string): Promise<void> {
    try {
      const current = await windowManagementService.getWindowBounds();
      if (this.store) {
        await windowManagementState.savePreviousBounds(current, this.store);
      }

      await windowManagementService.applyPreset(presetId);

      const label = presetId
        .split('-')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
      await feedbackService.showHUD(label);
    } catch (err: any) {
      logService.error(`[WindowManagement] applyPreset failed: ${err}`);
      await feedbackService.report({
        source: 'frontend',
        kind: 'manual',
        severity: 'error',
        retryable: false,
        context: { message: `Could not apply layout${err.message ? ' — ' + err.message : ''}` },
      });
    }
  }

  private async restorePreviousBounds(): Promise<void> {
    const prev = windowManagementState.previousBounds;
    if (!prev) {
      await feedbackService.report({
        source: 'frontend',
        kind: 'manual',
        severity: 'error',
        retryable: false,
        context: { message: 'Nothing to restore' },
      });
      return;
    }
    try {
      await windowManagementService.setWindowBounds(prev);
      await feedbackService.showHUD('Restored');
    } catch (err: any) {
      await feedbackService.report({
        source: 'frontend',
        kind: 'manual',
        severity: 'error',
        retryable: false,
        context: { message: `Restore failed${err.message ? ' — ' + err.message : ''}` },
      });
    }
  }

  async search(query: string): Promise<ExtensionResult[]> {
    const { customLayouts } = windowManagementState;
    if (!customLayouts.length) return [];

    const q = query.toLowerCase();
    const matched = customLayouts.filter((l) => l.name.toLowerCase().includes(q));

    return matched.map((layout) => ({
      id: `cmd_window-management_layout_${layout.id}`,
      title: layout.name,
      subtitle: `${Math.round(layout.bounds.width)}x${Math.round(layout.bounds.height)} at (${Math.round(layout.bounds.x)}, ${Math.round(layout.bounds.y)})`,
      score: 0.7,
      type: 'result' as const,
      icon: 'icon:store',
      action: async () => {
        await applyCustomLayout(layout, this.store);
      },
    }));
  }

  private handleKeydownBound = (event: KeyboardEvent) => this.handleKeydown(event);

  async viewActivated(viewPath: string): Promise<void> {
    this.inView = true;
    window.addEventListener('keydown', this.handleKeydownBound);
    this.registerManageActions();
    this.extensionManager?.setActiveViewActionLabel('Apply');
    logService.debug(`[WindowManagement] View activated: ${viewPath}`);
  }

  async viewDeactivated(viewPath: string): Promise<void> {
    this.inView = false;
    window.removeEventListener('keydown', this.handleKeydownBound);
    this.unregisterManageActions();
    logService.debug(`[WindowManagement] View deactivated: ${viewPath}`);
  }

  private handleKeydown(event: KeyboardEvent): void {
    if (!this.inView) return;
    if (isAnyModalOpen(document)) return;
    const layouts = windowManagementState.customLayouts;
    if (!layouts.length) return;

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      windowManagementState.moveSelection(event.key === 'ArrowUp' ? 'up' : 'down');
    } else if (event.key === 'Enter') {
      const selected = windowManagementState.selectedLayout;
      if (selected) {
        event.preventDefault();
        event.stopPropagation();
        void applyCustomLayout(selected, this.store);
      }
    }
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
    });
  }

  private unregisterManageActions(): void {
    actionService.unregisterAction('window-management:save-current-window');
  }

  private async saveCurrentWindowLayout(): Promise<void> {
    if (!this.store) return;
    try {
      const bounds = await windowManagementService.getWindowBounds();
      const name = `${Math.round(bounds.width)}x${Math.round(bounds.height)}`;
      await windowManagementState.addCustomLayout(name, bounds, this.store);
      const created =
        windowManagementState.customLayouts.find(
          (l) => l.name === name && l.bounds.x === bounds.x && l.bounds.y === bounds.y,
        ) ?? windowManagementState.customLayouts[windowManagementState.customLayouts.length - 1];
      if (created) {
        await syncLayoutToIndex(created, this.store);
      }
      await feedbackService.showHUD(`Saved "${name}"`);
    } catch (err: any) {
      await feedbackService.report({
        source: 'frontend',
        kind: 'manual',
        severity: 'error',
        retryable: false,
        context: { message: `Could not save layout${err.message ? ' — ' + err.message : ''}` },
      });
    }
  }

  async activate(): Promise<void> {}
  async deactivate(): Promise<void> {
    if (this.inView) this.unregisterManageActions();
  }
}

export default new WindowManagementExtension();
export { ManageView };
