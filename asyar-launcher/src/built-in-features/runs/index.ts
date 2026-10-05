import { t } from '../../services/i18n';
import type { Extension, ExtensionContext } from 'asyar-sdk/contracts';
import { ActionContext } from 'asyar-sdk/contracts';
import RunView from './RunView.svelte';
import { viewManager } from '../../services/extension/viewManager.svelte';
import { runService } from '../../services/run/runService.svelte';
import { actionService, type ApplicationAction } from '../../services/action/actionService.svelte';
import { openAgentRunInChat } from '../agents/runNavigation';

const CLEAR_RECENT_ACTION_ID = 'runs:clear-recent';
const OPEN_AGENT_RUN_IN_CHAT_ACTION_ID = 'agents:open-run-in-chat';

class RunsExtension implements Extension {
  private inView = false;
  private readonly handleKeydownBound = (event: KeyboardEvent) => this.handleKeydown(event);

  onUnload = () => {};

  async initialize(_context: ExtensionContext): Promise<void> {}

  async executeCommand(commandId: string, args?: Record<string, unknown>): Promise<unknown> {
    if (commandId === 'open-runs') {
      const argsWithId = args as { arguments?: { id?: string } } | undefined;
      const id = argsWithId?.arguments?.id;
      runService.selectedRunId = id ?? null;
      viewManager.navigateToView('runs/RunView');
    }
    return undefined;
  }

  private registerViewActions(): void {
    actionService.registerAction({
      id: CLEAR_RECENT_ACTION_ID,
      label: t('features.runs.act.clear_recent'),
      icon: 'icon:trash',
      extensionId: 'runs',
      context: ActionContext.EXTENSION_VIEW,
      execute: async () => {
        await runService.clearHistory();
        actionService.refreshFiltered();
      },
      visible: () => (runService.recent?.length ?? 0) > 0,
    } as ApplicationAction);

    actionService.registerAction({
      id: OPEN_AGENT_RUN_IN_CHAT_ACTION_ID,
      label: t('features.runs.act.view_conversation'),
      icon: '💬',
      description: t('features.runs.act.view_conversation_desc'),
      category: t('categories.agents'),
      extensionId: 'runs',
      context: ActionContext.EXTENSION_VIEW,
      visible: () => this.selectedAgentRunId() !== null,
      execute: async () => {
        const runId = this.selectedAgentRunId();
        if (runId) await openAgentRunInChat(runId);
      },
    } as ApplicationAction);
  }

  private unregisterViewActions(): void {
    actionService.unregisterAction(CLEAR_RECENT_ACTION_ID);
    actionService.unregisterAction(OPEN_AGENT_RUN_IN_CHAT_ACTION_ID);
  }

  async activate(): Promise<void> {
    await runService.loadHistory();
  }

  async deactivate(): Promise<void> {
    this.inView = false;
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.handleKeydownBound);
    }
    this.unregisterViewActions();
    runService.selectedRunId = null;
  }

  async viewActivated(_viewPath: string): Promise<void> {
    this.inView = true;
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.handleKeydownBound);
      window.addEventListener('keydown', this.handleKeydownBound);
    }

    this.registerViewActions();

    // Initial history load might complete after registerAction
    runService.loadHistory().then(() => {
      actionService.refreshFiltered();
    });
  }

  async viewDeactivated(_viewPath: string): Promise<void> {
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.handleKeydownBound);
    }
    this.inView = false;
    this.unregisterViewActions();
    runService.selectedRunId = null;
  }

  private selectedAgentRunId(): string | null {
    const selectedRunId = runService.selectedRunId;
    if (!selectedRunId) return null;
    const selectedRun = runService.combined.find((run) => run.id === selectedRunId);
    return selectedRun?.kind === 'agent' || selectedRun?.kind === 'ai-chat' ? selectedRun.id : null;
  }

  private handleKeydown(event: KeyboardEvent): void {
    if (!this.inView) return;
    if (event.key === 'Enter') {
      if (!this.selectedAgentRunId()) return;
      event.preventDefault();
      event.stopPropagation();
      void actionService.executeAction(OPEN_AGENT_RUN_IN_CHAT_ACTION_ID);
      return;
    }
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    if (runService.combined.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    runService.moveSelection(event.key === 'ArrowUp' ? 'up' : 'down');
  }
}

export default new RunsExtension();
export { RunView };
