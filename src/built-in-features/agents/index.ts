import type { Extension, ExtensionContext, IExtensionManager } from 'asyar-sdk/contracts';
import { ActionContext } from 'asyar-sdk/contracts';
import { dispatchAgentCommand } from './dispatch';
import { agentsManager } from './agentsManager.svelte';
import { agentService } from './agentService.svelte';
import { runAgent } from './agentLoop';
import { deriveThreadTitle, ensureThread } from './agentChatView.helpers';
import { actionService } from '../../services/action/actionService.svelte';
import { runService } from '../../services/run/runService.svelte';
import { viewManager } from '../../services/extension/viewManager.svelte';
import { agentsFindRunOrigin } from '../../lib/ipc/commands';
import { logService } from '../../services/log/logService';
import { contextModeService } from '../../services/context/contextModeService.svelte';
import { settingsService } from '../../services/settings/settingsService.svelte';
import { decideTabDestination } from './tabRouter';
import { openAgentForTab } from './threadOpener';
import AgentListView from './AgentListView.svelte';
import AgentEditView from './AgentEditView.svelte';
import AgentChatView from './AgentChatView.svelte';
import { registerBuiltinDynamicDispatcher } from '../../services/extension/builtinDynamicDispatchers';

export { AgentListView, AgentEditView, AgentChatView };

registerBuiltinDynamicDispatcher('agents', dispatchAgentCommand);

const ACTION_NEW_AGENT = 'agents:new-agent';
const ACTION_EDIT_AGENT = 'agents:edit-agent';
const ACTION_DELETE_AGENT = 'agents:delete-agent';
const ACTION_NEW_THREAD = 'agents:new-thread';
const ACTION_DELETE_THREAD = 'agents:delete-thread';
const ACTION_CANCEL_SEND = 'agents:cancel-send';
const ACTION_OPEN_RUN_IN_CHAT = 'agents:open-run-in-chat';

class AgentsExtension implements Extension {
  private extensionManager?: IExtensionManager;

  async initialize(context: ExtensionContext): Promise<void> {
    this.extensionManager = context.getService<IExtensionManager>('extensions');

    // Manifest-declared action executors. These show in Cmd+K when "Manage
    // Agents" is highlighted in launcher search results (manifest-action
    // visibility model — see ExtensionLoader.registerManifestActions).
    actionService.setActionExecutor('act_agents_new-agent', async () => {
      this.runNewAgent();
    });
    actionService.setActionExecutor('act_agents_edit-agent', async () => {
      this.runEditAgent();
    });
    actionService.setActionExecutor('act_agents_delete-agent', async () => {
      await this.runDeleteAgent();
    });
    actionService.setActionExecutor('act_agents_new-thread', async () => {
      await this.runNewThread();
    });
    actionService.setActionExecutor('act_agents_delete-thread', async () => {
      await this.runDeleteThread();
    });

    contextModeService.registerProvider({
      id: 'agents:default',
      triggers: ['ask ai'],
      display: {
        name: 'AI',
        icon: 'icon:ai-chat',
        color: '#7c3aed',
      },
      type: 'stream',
      onActivate: async (initialQuery?: string) => {
        const settings = settingsService.currentSettings;
        const decision = decideTabDestination({
          defaultAgentId: settings.ai.defaultAgentId,
          agents: agentService.agents,
        });
        await openAgentForTab(
          decision.agentId,
          initialQuery ?? '',
          settings.ai.tabContinuesLastThread,
        );
      },
      onDeactivate: () => {},
    });

    // Cross-view action: visible whenever the user has selected an agent run
    // in the Runs view. Lets them jump from the run row to the chat thread
    // that produced it.
    actionService.registerAction({
      id: ACTION_OPEN_RUN_IN_CHAT,
      label: 'Open Run in Chat',
      icon: '💬',
      description: 'Jump to the agent chat thread that produced this run',
      category: 'Agents',
      extensionId: 'agents',
      context: ActionContext.EXTENSION_VIEW,
      visible: () => {
        if (viewManager.activeView !== 'runs/RunView') return false;
        const id = runService.selectedRunId;
        if (!id) return false;
        const all = [...runService.active, ...runService.recent];
        const run = all.find((r) => r.id === id);
        return run?.extensionId === 'agents';
      },
      execute: async () => {
        const id = runService.selectedRunId;
        if (!id) return;
        try {
          const origin = await agentsFindRunOrigin(id);
          if (!origin) {
            logService.warn(`[agents] no thread found for run ${id}`);
            return;
          }
          agentsManager.currentAgentId = origin.agentId;
          agentsManager.currentThreadId = origin.threadId;
          this.extensionManager?.navigateToView('agents/AgentChatView');
        } catch (err) {
          logService.warn(`[agents] open-run-in-chat failed: ${err}`);
        }
      },
    });
  }

  async activate(): Promise<void> {
    await agentsManager.start();
  }

  async deactivate(): Promise<void> {
    this.unregisterListViewActions();
    this.unregisterChatViewActions();
    await agentsManager.stop();
  }

  async viewActivated(viewId: string): Promise<void> {
    if (viewId === 'agents/AgentListView') {
      this.registerListViewActions();
    } else if (viewId === 'agents/AgentChatView') {
      this.registerChatViewActions();
    }
  }

  async viewDeactivated(viewId: string): Promise<void> {
    if (viewId === 'agents/AgentListView') {
      this.unregisterListViewActions();
    } else if (viewId === 'agents/AgentChatView') {
      this.unregisterChatViewActions();
    }
  }

  // ── Action implementations ─────────────────────────────────────────────────

  private runNewAgent(): void {
    agentsManager.currentAgentId = null;
    this.extensionManager?.navigateToView('agents/AgentEditView');
  }

  private runEditAgent(): void {
    if (!agentsManager.currentAgentId) return;
    this.extensionManager?.navigateToView('agents/AgentEditView');
  }

  private async runDeleteAgent(): Promise<void> {
    const agentId = agentsManager.currentAgentId;
    if (!agentId) return;
    try {
      await agentService.delete(agentId);
      await agentsManager.refresh();
      agentsManager.currentAgentId = null;
    } catch (err) {
      logService.warn(`[agents] delete-agent action failed: ${err}`);
    }
  }

  private async runNewThread(): Promise<void> {
    const agentId = agentsManager.currentAgentId;
    if (!agentId) return;
    try {
      const thread = await agentService.createThread(agentId, '');
      agentsManager.currentThreadId = thread.id;
    } catch (err) {
      logService.warn(`[agents] new-thread action failed: ${err}`);
    }
  }

  private async runDeleteThread(): Promise<void> {
    const threadId = agentsManager.currentThreadId;
    if (!threadId) return;
    try {
      await agentService.deleteThread(threadId);
      agentsManager.currentThreadId = null;
    } catch (err) {
      logService.warn(`[agents] delete-thread action failed: ${err}`);
    }
  }

  private runCancelSend(): void {
    agentsManager.activeAbortController?.abort();
  }

  // ── View-context action registration ───────────────────────────────────────

  private registerListViewActions(): void {
    actionService.registerAction({
      id: ACTION_NEW_AGENT,
      label: 'New Agent',
      icon: '✨',
      description: 'Create a new agent',
      category: 'Agents',
      extensionId: 'agents',
      context: ActionContext.EXTENSION_VIEW,
      execute: async () => this.runNewAgent(),
    });
    actionService.registerAction({
      id: ACTION_EDIT_AGENT,
      label: 'Edit Agent',
      icon: '✏️',
      description: 'Edit the selected agent',
      category: 'Agents',
      extensionId: 'agents',
      context: ActionContext.EXTENSION_VIEW,
      execute: async () => this.runEditAgent(),
    });
    actionService.registerAction({
      id: ACTION_DELETE_AGENT,
      label: 'Delete Agent',
      icon: '🗑️',
      description: 'Delete the selected agent',
      category: 'Agents',
      extensionId: 'agents',
      context: ActionContext.EXTENSION_VIEW,
      execute: async () => this.runDeleteAgent(),
    });
  }

  private unregisterListViewActions(): void {
    actionService.unregisterAction(ACTION_NEW_AGENT);
    actionService.unregisterAction(ACTION_EDIT_AGENT);
    actionService.unregisterAction(ACTION_DELETE_AGENT);
  }

  private registerChatViewActions(): void {
    actionService.registerAction({
      id: ACTION_NEW_THREAD,
      label: 'New Thread',
      icon: '💬',
      description: 'Start a new conversation thread',
      category: 'Agents',
      extensionId: 'agents',
      context: ActionContext.EXTENSION_VIEW,
      execute: async () => this.runNewThread(),
    });
    actionService.registerAction({
      id: ACTION_DELETE_THREAD,
      label: 'Delete Current Thread',
      icon: '🗑️',
      description: 'Delete the active conversation thread',
      category: 'Agents',
      extensionId: 'agents',
      context: ActionContext.EXTENSION_VIEW,
      execute: async () => this.runDeleteThread(),
    });
    actionService.registerAction({
      id: ACTION_CANCEL_SEND,
      label: 'Cancel Run',
      icon: '⛔',
      description: 'Abort the in-flight assistant response',
      category: 'Agents',
      extensionId: 'agents',
      context: ActionContext.EXTENSION_VIEW,
      visible: () => agentsManager.sending,
      execute: async () => this.runCancelSend(),
    });
  }

  private unregisterChatViewActions(): void {
    actionService.unregisterAction(ACTION_NEW_THREAD);
    actionService.unregisterAction(ACTION_DELETE_THREAD);
    actionService.unregisterAction(ACTION_CANCEL_SEND);
  }

  async executeCommand(commandId: string, args?: Record<string, unknown>): Promise<unknown> {
    if (commandId === 'manage-agents') {
      return { type: 'view', viewPath: 'agents/AgentListView' };
    }
    if (commandId === 'ask') {
      const query = typeof args?.query === 'string' ? args.query : '';
      const settings = settingsService.currentSettings;
      const decision = decideTabDestination({
        defaultAgentId: settings.ai.defaultAgentId,
        agents: agentService.agents,
      });
      await openAgentForTab(decision.agentId, query, settings.ai.tabContinuesLastThread);
      return { type: 'view', viewPath: 'agents/AgentChatView' };
    }
    await dispatchAgentCommand(commandId, args);
    return { type: 'no-view' };
  }

  /**
   * Called when the user types in the launcher search bar while the
   * AgentChatView is active and presses Enter. Routes the query as a new
   * message to the active agent + thread. Mirrors ai-chat's flow so the
   * search bar is the omnipresent chat input.
   */
  async onViewSubmit(query: string): Promise<void> {
    const text = query.trim();
    if (text.length === 0) return;

    const agentId = agentsManager.currentAgentId;
    if (!agentId) return;
    if (agentsManager.sending) return;

    // Ensure a thread exists; create on first send if none.
    let threadId = agentsManager.currentThreadId;
    if (!threadId) {
      try {
        const thread = await ensureThread(agentId, { service: agentService });
        threadId = thread.id;
        agentsManager.currentThreadId = threadId;
      } catch (err) {
        logService.warn(`[agents] ensureThread failed: ${err}`);
        return;
      }
    }

    // Auto-derive a title on the first user message of an unnamed thread.
    const thread = (await agentService.listThreads(agentId)).find((t) => t.id === threadId);
    if (thread && (!thread.title || thread.title.trim() === '')) {
      try {
        await agentService.updateThreadTitle(threadId, deriveThreadTitle(text));
      } catch (err) {
        logService.warn(`[agents] updateThreadTitle failed: ${err}`);
      }
    }

    const controller = new AbortController();
    agentsManager.activeAbortController = controller;
    agentsManager.sending = true;
    agentsManager.streamingText = '';

    try {
      await runAgent({
        agentId,
        threadId,
        userText: text,
        abortSignal: controller.signal,
        onUserMessagePersisted: () => {
          // Chat view watches `agentsManager.sending` + listens for refresh
          // via its own effect against listMessages, so just nudge here.
          agentsManager.streamingText = '';
        },
        onAssistantTextDelta: (_delta, accumulated) => {
          agentsManager.streamingText = accumulated;
        },
        onAssistantTurnPersisted: () => {
          agentsManager.streamingText = '';
        },
      });
    } catch (err) {
      logService.warn(`[agents] runAgent failed: ${err}`);
    } finally {
      agentsManager.sending = false;
      agentsManager.activeAbortController = null;
      agentsManager.streamingText = '';
    }
  }
}

const extension = new AgentsExtension();
export default extension;
