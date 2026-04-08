import type { Extension, ExtensionContext, IExtensionManager } from 'asyar-sdk';
import DefaultView from './DefaultView.svelte';
import { portalStore, type Portal } from './portalStore.svelte';
import { invoke } from '@tauri-apps/api/core';
import { searchService } from '../../services/search/SearchService';
import { commandService } from '../../services/extension/commandService.svelte';
import { actionService } from '../../services/action/actionService.svelte';
import { ActionContext } from 'asyar-sdk';
import { contextModeService } from '../../services/context/contextModeService.svelte';
import { resolveTemplate } from '../../lib/placeholders';

class PortalsUiState {
  openMode = $state<'list' | 'new'>('list');
  selectedIndex = $state<number>(-1);
}
export const portalsUiState = new PortalsUiState();

export async function syncPortalToIndex(portal: Portal): Promise<void> {
  await searchService.indexItem({
    category: 'command',
    id: `cmd_portals_${portal.id}`,
    name: portal.name,
    extension: 'portals',
    trigger: portal.name,
    type: 'portal',
    icon: portal.icon,
  });

  // Register runtime command handler
  commandService.registerCommand(`cmd_portals_${portal.id}`, {
    execute: async (args?: Record<string, any>) => {
      const query = args?.query ?? '';
      const url = await resolveTemplate(portal.url, { query }, { encodeValues: true });
      await invoke('plugin:opener|open_url', { url });
      return { type: 'no-view' };
    },
  }, 'portals');

  // Register with context mode service so it participates in the chip/hint system
  registerPortalContextProvider(portal);
}

export async function removePortalFromIndex(portalId: string): Promise<void> {
  await searchService.deleteItem(`cmd_portals_${portalId}`);
  commandService.unregisterCommand(`cmd_portals_${portalId}`);
  contextModeService.unregisterProvider(`portal_${portalId}`);
}

function registerPortalContextProvider(portal: Portal): void {
  contextModeService.registerProvider({
    id: `portal_${portal.id}`,
    triggers: [portal.name],
    display: {
      name: portal.name,
      icon: portal.icon,
      // No custom color — portals use the default accent-primary chip color
    },
    type: 'url',
    onActivate: async (query?: string) => {
      if (!query) return; // Tab activation: just set the chip, don't open browser
      const url = await resolveTemplate(portal.url, { query }, { encodeValues: true });
      await invoke('plugin:opener|open_url', { url });
      searchService.saveIndex();
      await invoke('hide');
    },
  });
}

class PortalsExtension implements Extension {
  onUnload = () => {};
  private extensionManager?: IExtensionManager;
  private inView = false;
  private handleKeydownBound = (e: KeyboardEvent) => this.handleKeydown(e);

  async initialize(context: ExtensionContext): Promise<void> {
    this.extensionManager = context.getService<IExtensionManager>('ExtensionManager');
    const portals = portalStore.portals;
    for (const portal of portals) {
      await syncPortalToIndex(portal);
    }
  }

  async executeCommand(commandId: string, args?: Record<string, any>): Promise<any> {
    if (commandId === 'open-portals') {
      this.extensionManager?.navigateToView('portals/DefaultView');
      return { type: 'view', viewPath: 'portals/DefaultView' };
    }
    if (commandId === 'new-portal') {
      portalsUiState.openMode = 'new';
      this.extensionManager?.navigateToView('portals/DefaultView');
      return { type: 'view', viewPath: 'portals/DefaultView' };
    }
    // Dynamic portal fallback
    const portal = portalStore.getById(commandId);
    if (portal) {
      const query = args?.query ?? '';
      const url = await resolveTemplate(portal.url, { query }, { encodeValues: true });
      await invoke('plugin:opener|open_url', { url });
      return { type: 'no-view' };
    }
  }

  async viewActivated(_viewId: string): Promise<void> {
    this.inView = true;
    portalsUiState.selectedIndex = -1;
    window.addEventListener('keydown', this.handleKeydownBound);
    this.registerViewActions();
  }

  async viewDeactivated(_viewId: string): Promise<void> {
    this.inView = false;
    window.removeEventListener('keydown', this.handleKeydownBound);
    this.unregisterViewActions();
    portalsUiState.openMode = 'list';
    portalsUiState.selectedIndex = -1;
  }

  private handleKeydown(event: KeyboardEvent) {
    if (!this.inView) return;
    const portals = portalStore.getAll();
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
      label: 'New Portal',
      icon: '➕',
      description: 'Add a new portal URL shortcut',
      category: 'Portals',
      extensionId: 'portals',
      context: ActionContext.EXTENSION_VIEW,
      execute: async () => {
        portalsUiState.openMode = 'new';
      },
    });
  }

  private unregisterViewActions() {
    actionService.unregisterAction('portals:new-portal');
  }

  async activate(): Promise<void> {}
  async deactivate(): Promise<void> {
    if (this.inView) this.unregisterViewActions();
  }
}

export default new PortalsExtension();
export { DefaultView };
