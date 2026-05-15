import type { Extension, ExtensionContext } from 'asyar-sdk/contracts';
import RunView from './RunView.svelte';
import { viewManager } from '../../services/extension/viewManager.svelte';
import { runService } from '../../services/run/runService.svelte';

class RunsExtension implements Extension {
  private inView = false;
  private readonly handleKeydownBound = (event: KeyboardEvent) => this.handleKeydown(event);

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

  async viewActivated(_viewPath: string): Promise<void> {
    this.inView = true;
    window.addEventListener('keydown', this.handleKeydownBound);
  }

  async viewDeactivated(_viewPath: string): Promise<void> {
    window.removeEventListener('keydown', this.handleKeydownBound);
    this.inView = false;
  }

  private handleKeydown(event: KeyboardEvent): void {
    if (!this.inView) return;
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    if (runService.combined.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    runService.moveSelection(event.key === 'ArrowUp' ? 'up' : 'down');
  }
}

export default new RunsExtension();
export { RunView };
