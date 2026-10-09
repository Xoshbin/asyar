import type { Extension, ExtensionContext, IExtensionManager } from 'asyar-sdk/contracts';
import { ActionContext } from 'asyar-sdk/contracts';
import { dispatchAgentCommand } from './dispatch';
import { agentsManager } from './agentsManager.svelte';
import { agentService } from './agentService.svelte';
import { runAgent } from './agentLoop';
import { ensureThread } from './agentChatView.helpers';
import { actionService } from '../../services/action/actionService.svelte';
import { copyText } from '../../utils/copyText';
import { t } from '../../services/i18n';
import { logService } from '../../services/log/logService';
import { contextModeService } from '../../services/context/contextModeService.svelte';
import { settingsService } from '../../services/settings/settingsService.svelte';
import { decideTabDestination } from './tabRouter';
import { openAgentForTab, registerAgentSubmitHandler } from './threadOpener';
import AgentListView from './AgentListView.svelte';
import AgentEditView from './AgentEditView.svelte';
import AgentChatView from './AgentChatView.svelte';
import { registerBuiltinDynamicDispatcher } from '../../services/extension/builtinDynamicDispatchers';
import type { ThreadDef } from './types';

export { AgentListView, AgentEditView, AgentChatView };

registerBuiltinDynamicDispatcher('agents', dispatchAgentCommand);

const ACTION_NEW_AGENT = 'agents:new-agent';
const ACTION_EDIT_AGENT = 'agents:edit-agent';
const ACTION_DELETE_AGENT = 'agents:delete-agent';
const ACTION_NEW_THREAD = 'agents:new-thread';
const ACTION_DELETE_THREAD = 'agents:delete-thread';
const ACTION_CANCEL_SEND = 'agents:cancel-send';
const ACTION_COPY_LAST_RESPONSE = 'agents:copy-last-response';

class AgentsExtension implements Extension {
  private extensionManager?: IExtensionManager;

  async initialize(context: ExtensionContext): Promise<void> {
    this.extensionManager = context.getService<IExtensionManager>('extensions');

    this.registerContextMode();
  }

  private registerContextMode(): void {
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
  }

  private unregisterContextMode(): void {
    contextModeService.unregisterProvider('agents:default');
  }

  async activate(): Promise<void> {
    this.registerContextMode();
    await agentsManager.start();
  }

  async deactivate(): Promise<void> {
    this.unregisterContextMode();
    this.unregisterListViewActions();
    this.unregisterChatViewActions();
    agentsManager.activeAbortController?.abort();
    agentsManager.activeAbortController = null;
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
      // The user may have switched agent while the thread was being created;
      // selecting it then would point the new agent at a foreign thread.
      if (agentsManager.currentAgentId !== agentId) return;
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

  private async runCopyLastResponse(): Promise<void> {
    const text = agentsManager.lastAssistantMessageText;
    if (!text) return;
    await copyText(text);
  }

  // ── View-context action registration ───────────────────────────────────────

  private registerListViewActions(): void {
    actionService.registerAction({
      id: ACTION_NEW_AGENT,
      label: t('features.agents.act.new'),
      icon: '✨',
      description: t('features.agents.act.new_desc'),
      category: t('categories.agents'),
      extensionId: 'agents',
      context: ActionContext.EXTENSION_VIEW,
      execute: async () => this.runNewAgent(),
    });
    actionService.registerAction({
      id: ACTION_EDIT_AGENT,
      label: t('features.agents.act.edit'),
      icon: '✏️',
      description: t('features.agents.act.edit_desc'),
      category: t('categories.agents'),
      extensionId: 'agents',
      context: ActionContext.EXTENSION_VIEW,
      execute: async () => this.runEditAgent(),
    });
    actionService.registerAction({
      id: ACTION_DELETE_AGENT,
      label: t('features.agents.act.delete'),
      icon: '🗑️',
      description: t('features.agents.act.delete_desc'),
      category: t('categories.agents'),
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
      label: t('features.agents.act.new_thread'),
      icon: '💬',
      shortcut: 'Mod+N',
      description: t('features.agents.act.new_thread_desc'),
      category: t('categories.agents'),
      extensionId: 'agents',
      context: ActionContext.EXTENSION_VIEW,
      execute: async () => this.runNewThread(),
    });
    actionService.registerAction({
      id: ACTION_DELETE_THREAD,
      label: t('features.agents.act.delete_thread'),
      icon: '🗑️',
      description: t('features.agents.act.delete_thread_desc'),
      category: t('categories.agents'),
      extensionId: 'agents',
      context: ActionContext.EXTENSION_VIEW,
      execute: async () => this.runDeleteThread(),
    });
    actionService.registerAction({
      id: ACTION_CANCEL_SEND,
      label: t('features.agents.act.cancel'),
      icon: '⛔',
      description: t('features.agents.act.cancel_desc'),
      category: t('categories.agents'),
      extensionId: 'agents',
      context: ActionContext.EXTENSION_VIEW,
      visible: () => agentsManager.sending,
      execute: async () => this.runCancelSend(),
    });
    actionService.registerAction({
      id: ACTION_COPY_LAST_RESPONSE,
      label: t('features.agents.copy_last_response'),
      icon: '📋',
      description: t('features.agents.copy_last_response_description'),
      category: t('categories.agents'),
      extensionId: 'agents',
      context: ActionContext.EXTENSION_VIEW,
      shortcut: 'Mod+Shift+C',
      visible: () => !agentsManager.sending && !!agentsManager.lastAssistantMessageText,
      execute: async () => this.runCopyLastResponse(),
    });
  }

  private unregisterChatViewActions(): void {
    actionService.unregisterAction(ACTION_NEW_THREAD);
    actionService.unregisterAction(ACTION_DELETE_THREAD);
    actionService.unregisterAction(ACTION_CANCEL_SEND);
    actionService.unregisterAction(ACTION_COPY_LAST_RESPONSE);
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

    let thread: ThreadDef | undefined;
    try {
      const threads = await agentService.listThreads(agentId);
      thread = threads.find((candidate) => candidate.id === agentsManager.currentThreadId);
      if (!thread) {
        thread = await ensureThread(agentId, { service: agentService });
        agentsManager.currentThreadId = thread.id;
      }
    } catch (err) {
      logService.warn(`[agents] ensureThread failed: ${err}`);
      return;
    }

    await this.submitToThread(agentId, thread, text);
  }

  private async submitToThread(agentId: string, thread: ThreadDef, text: string): Promise<void> {
    const threadId = thread.id;
    const controller = new AbortController();
    agentsManager.activeAbortController = controller;
    agentsManager.sending = true;
    agentsManager.streamingText = '';
    agentsManager.streamingStatus = null;

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
          agentsManager.streamingStatus = null;
        },
        onAssistantStatus: (status) => {
          agentsManager.streamingStatus = status;
        },
        onAssistantTextDelta: (_delta, accumulated) => {
          agentsManager.streamingStatus = null;
          agentsManager.streamingText = accumulated;
        },
        onAssistantTurnPersisted: () => {
          agentsManager.streamingText = '';
          agentsManager.streamingStatus = null;
        },
      });
    } catch (err) {
      logService.warn(`[agents] runAgent failed: ${err}`);
    } finally {
      agentsManager.sending = false;
      agentsManager.activeAbortController = null;
      agentsManager.streamingText = '';
      agentsManager.streamingStatus = null;
    }
  }
}

const extension = new AgentsExtension();
registerAgentSubmitHandler((query) => extension.onViewSubmit(query));
export default extension;
