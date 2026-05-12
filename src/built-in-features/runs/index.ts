import type { Extension, ExtensionContext } from 'asyar-sdk/contracts';
import RunView from './RunView.svelte';
import { viewManager } from '../../services/extension/viewManager.svelte';
import { runService } from '../../services/run/runService.svelte';

class RunsExtension implements Extension {
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

  async activate(): Promise<void> {}

  async deactivate(): Promise<void> {}
}

export default new RunsExtension();
export { RunView };
