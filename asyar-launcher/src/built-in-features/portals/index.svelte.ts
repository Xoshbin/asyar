import type { Extension, ExtensionContext, IExtensionManager } from 'asyar-sdk/contracts';
import DefaultView from './DefaultView.svelte';
import { portalStore } from './portalStore.svelte';
import { openUrl } from '../../lib/ipc/commands';
import { actionService } from '../../services/action/actionService.svelte';
import { ActionContext } from 'asyar-sdk/contracts';
import { syncPortalToIndex } from './portalLifecycle';
import { resolveTemplate } from '../../lib/placeholders';

class PortalsUiState {
  openMode = $state<'list' | 'new'>('list');
  selectedIndex = $state<number>(-1);
}
export const portalsUiState = new PortalsUiState();

class PortalsExtension implements Extension {
  onUnload = () => {};
  private extensionManager?: IExtensionManager;
  private inView = false;
  private handleKeydownBound = (e: KeyboardEvent) => this.handleKeydown(e);

  async initialize(context: ExtensionContext): Promise<void> {
    this.extensionManager = context.getService<IExtensionManager>('extensions');
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
      await openUrl(url);
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
      icon: 'icon:plus',
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
