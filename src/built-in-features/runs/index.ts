import type { Extension, ExtensionContext } from 'asyar-sdk/contracts';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import RunView from './RunView.svelte';
import { viewManager } from '../../services/extension/viewManager.svelte';
import { runService } from '../../services/run/runService.svelte';

class RunsExtension implements Extension {
  private unlistenTrayOpen: UnlistenFn | null = null;
  onUnload = () => {};

  async initialize(_context: ExtensionContext): Promise<void> {}

  async executeCommand(
    commandId: string,
    args?: Record<string, unknown>,
  ): Promise<unknown> {
    if (commandId === 'open-runs') {
      const argsWithId = args as { arguments?: { id?: string } } | undefined;
      const id = argsWithId?.arguments?.id;
      runService.selectedRunId = id ?? null;
      viewManager.navigateToView('runs/RunView');
    }
    return undefined;
  }

  async activate(): Promise<void> {
    this.unlistenTrayOpen = await listen('tray:open-runs', () => {
      runService.selectedRunId = null;
      viewManager.navigateToView('runs/RunView');
    });
  }

  async deactivate(): Promise<void> {
    if (this.unlistenTrayOpen) {
      this.unlistenTrayOpen();
      this.unlistenTrayOpen = null;
    }
  }
}

export default new RunsExtension();
export { RunView };
