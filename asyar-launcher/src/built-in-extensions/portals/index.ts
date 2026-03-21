import type { Extension, ExtensionContext, IExtensionManager } from 'asyar-sdk';
import { writable } from 'svelte/store';
import DefaultView from './DefaultView.svelte';
import { portalStore, type Portal } from './portalStore';
import { invoke } from '@tauri-apps/api/core';
import { searchService } from '../../services/search/SearchService';
import { commandService } from '../../services/extension/commandService';
import { actionService } from '../../services/action/actionService';
import { ActionContext } from 'asyar-sdk';

// Shared stores — read by DefaultView.svelte
export const portalsOpenMode = writable<'list' | 'new'>('list');
export const portalsSelectedIndex = writable<number>(-1);

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

  // Register runtime command handler — required for handleCommandAction to route to this portal
  commandService.registerCommand(`cmd_portals_${portal.id}`, {
    execute: async (args?: Record<string, any>) => {
      const query = args?.query ?? '';
      const url = portal.url.includes('{query}')
        ? portal.url.replace(/\{query\}/g, encodeURIComponent(query))
        : portal.url;
      await invoke('plugin:opener|open_url', { url });
    },
  }, 'portals');
}

export async function removePortalFromIndex(portalId: string): Promise<void> {
  await searchService.deleteItem(`cmd_portals_${portalId}`);
  commandService.unregisterCommand(`cmd_portals_${portalId}`);
}

class PortalsExtension implements Extension {
  onUnload = () => {};
  private extensionManager?: IExtensionManager;
  private inView = false;
  private handleKeydownBound = (e: KeyboardEvent) => this.handleKeydown(e);

  async initialize(context: ExtensionContext): Promise<void> {
    this.extensionManager = context.getService<IExtensionManager>('ExtensionManager');
    const portals = portalStore.getAll();
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
      portalsOpenMode.set('new');
      this.extensionManager?.navigateToView('portals/DefaultView');
      return { type: 'view', viewPath: 'portals/DefaultView' };
    }
    // Dynamic portal fallback (should be handled by commandService now, but kept as safety net)
    const portal = portalStore.getById(commandId);
    if (portal) {
      const query = args?.query ?? '';
      const url = portal.url.includes('{query}')
        ? portal.url.replace(/\{query\}/g, encodeURIComponent(query))
        : portal.url;
      await invoke('plugin:opener|open_url', { url });
      return { type: 'no-view' };
    }
  }

  async viewActivated(_viewId: string): Promise<void> {
    this.inView = true;
    portalsSelectedIndex.set(-1);
    window.addEventListener('keydown', this.handleKeydownBound);
    this.registerViewActions();
  }

  async viewDeactivated(_viewId: string): Promise<void> {
    this.inView = false;
    window.removeEventListener('keydown', this.handleKeydownBound);
    this.unregisterViewActions();
    portalsOpenMode.set('list');
    portalsSelectedIndex.set(-1);
  }

  private handleKeydown(event: KeyboardEvent) {
    if (!this.inView) return;
    const portals = portalStore.getAll();
    if (!portals.length) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      event.stopPropagation();
      portalsSelectedIndex.update(i => Math.min(i + 1, portals.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      portalsSelectedIndex.update(i => Math.max(i - 1, 0));
    }
    // Enter is handled natively by the focused row button
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
        portalsOpenMode.set('new');
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
