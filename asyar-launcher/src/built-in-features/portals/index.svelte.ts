import { t } from '../../services/i18n';
import type { Extension, ExtensionContext, IExtensionManager } from 'asyar-sdk/contracts';
import { ActionContext } from 'asyar-sdk/contracts';
import DefaultView from './DefaultView.svelte';
import PortalForm from './PortalForm.svelte';
import { portalStore, type Portal } from './portalStore.svelte';
import { actionService } from '../../services/action/actionService.svelte';
import { viewManager } from '../../services/extension/viewManager.svelte';
import { registerBuiltinDynamicDispatcher } from '../../services/extension/builtinDynamicDispatchers';
import {
  cleanupLegacyPortalIndexEntries,
  clearAllPortalsFromIndex,
  dispatchPortalCommand,
  openPortal,
  syncAllPortalsToIndex,
} from './portalLifecycle';
import { importPortalsFromJsonDialog } from './importPortalsJson';

registerBuiltinDynamicDispatcher('portals', dispatchPortalCommand);

export const ALL_TAGS_VALUE = '__all__';

class PortalsUiState {
  selectedIndex = $state<number>(-1);
  formMode = $state<'create' | 'edit'>('create');
  editingPortal = $state<Portal | null>(null);
  searchQuery = $state<string>('');
  selectedTag = $state<string>(ALL_TAGS_VALUE);

  filteredPortals = $derived.by(() => {
    const q = this.searchQuery.trim().toLowerCase();
    const tag = this.selectedTag;
    const list = portalStore.portals.filter((p) => {
      if (tag && tag !== ALL_TAGS_VALUE) {
        if (!p.tags?.some((item) => item === tag)) return false;
      }
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.url.toLowerCase().includes(q) ||
        Boolean(p.tags?.some((item) => item.toLowerCase().includes(q)))
      );
    });

    const pinned = list.filter((p) => p.pinned);
    const unpinned = list.filter((p) => !p.pinned);
    return [...pinned, ...unpinned];
  });

  startCreate() {
    this.formMode = 'create';
    this.editingPortal = null;
  }

  startEdit(portal: Portal) {
    this.formMode = 'edit';
    this.editingPortal = portal;
  }

  clearDraft() {
    this.formMode = 'create';
    this.editingPortal = null;
  }
}
export const portalsUiState = new PortalsUiState();

class PortalsExtension implements Extension {
  onUnload = () => {};
  private extensionManager?: IExtensionManager;
  private inView = false;
  private handleKeydownBound = (e: KeyboardEvent) => this.handleKeydown(e);

  async initialize(context: ExtensionContext): Promise<void> {
    this.extensionManager = context.getService<IExtensionManager>('extensions');
    await cleanupLegacyPortalIndexEntries();
    await syncAllPortalsToIndex();
  }

  async executeCommand(commandId: string, args?: Record<string, unknown>): Promise<unknown> {
    if (commandId === 'open-portals') {
      this.extensionManager?.navigateToView('portals/DefaultView');
      return { type: 'view', viewPath: 'portals/DefaultView' };
    }
    if (commandId === 'create-portal') {
      portalsUiState.startCreate();
      viewManager.navigateToView('portals/PortalFormView', { searchable: false });
      return { type: 'view', viewPath: 'portals/PortalFormView' };
    }
    if (commandId === 'import-portals') {
      await importPortalsFromJsonDialog();
      return { type: 'no-view' };
    }
    // Dynamic portal fallback
    const portal = portalStore.getById(commandId);
    if (portal) {
      await openPortal(portal, args);
      return { type: 'no-view' };
    }
    return undefined;
  }

  async onViewSearch(query: string): Promise<void> {
    if (portalsUiState.searchQuery === query) return;
    portalsUiState.searchQuery = query;
    const list = portalsUiState.filteredPortals;
    portalsUiState.selectedIndex = list.length > 0 ? 0 : -1;
  }

  async onViewSubmit(_query: string): Promise<void> {
    const list = portalsUiState.filteredPortals;
    const idx = portalsUiState.selectedIndex;
    const portal = idx >= 0 && idx < list.length ? list[idx] : null;
    if (portal) {
      await openPortal(portal);
    }
  }

  async viewActivated(viewId: string): Promise<void> {
    if (viewId !== 'portals/DefaultView') return;
    this.inView = true;
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.handleKeydownBound);
      window.addEventListener('keydown', this.handleKeydownBound);
    }
    this.registerViewActions();
  }

  async viewDeactivated(viewId: string): Promise<void> {
    if (viewId === 'portals/PortalFormView') {
      portalsUiState.clearDraft();
      return;
    }
    this.inView = false;
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.handleKeydownBound);
    }
    this.unregisterViewActions();
    if (!viewManager.isViewInStack('portals/DefaultView')) {
      portalsUiState.clearDraft();
      portalsUiState.selectedIndex = -1;
      portalsUiState.searchQuery = '';
      portalsUiState.selectedTag = ALL_TAGS_VALUE;
    }
  }

  private handleKeydown(event: KeyboardEvent) {
    if (!this.inView) return;
    const portals = portalsUiState.filteredPortals;
    if (!portals.length) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      event.stopPropagation();
      portalsUiState.selectedIndex = Math.min(portalsUiState.selectedIndex + 1, portals.length - 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      portalsUiState.selectedIndex = Math.max(portalsUiState.selectedIndex - 1, 0);
    }
  }

  private registerViewActions() {
    actionService.registerAction({
      id: 'portals:new-portal',
      label: t('features.portals.act.new'),
      icon: 'icon:plus',
      shortcut: 'Mod+N',
      description: t('features.portals.act.new_desc'),
      category: t('categories.portals'),
      extensionId: 'portals',
      context: ActionContext.EXTENSION_VIEW,
      execute: async () => {
        portalsUiState.startCreate();
        viewManager.navigateToView('portals/PortalFormView', { searchable: false });
      },
    });
    actionService.registerAction({
      id: 'portals:import',
      label: t('features.portals.act.import'),
      icon: 'icon:download',
      description: t('features.portals.act.import_desc'),
      category: t('categories.portals'),
      extensionId: 'portals',
      context: ActionContext.EXTENSION_VIEW,
      execute: async () => {
        await importPortalsFromJsonDialog();
      },
    });
  }

  private unregisterViewActions() {
    actionService.unregisterAction('portals:new-portal');
    actionService.unregisterAction('portals:import');
  }

  async activate(): Promise<void> {
    await cleanupLegacyPortalIndexEntries();
    await syncAllPortalsToIndex();
  }

  async deactivate(): Promise<void> {
    this.inView = false;
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.handleKeydownBound);
    }
    this.unregisterViewActions();
    portalsUiState.clearDraft();
    portalsUiState.selectedIndex = -1;
    await clearAllPortalsFromIndex();
  }
}

export default new PortalsExtension();
export { DefaultView, PortalForm as PortalFormView };
