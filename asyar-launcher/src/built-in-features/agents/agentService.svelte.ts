import {
  agentsList,
  agentsCreate,
  agentsUpdate,
  agentsDelete,
  agentsThreadsList,
  agentsThreadCreate,
  agentsThreadSetPinned,
  agentsThreadsPrune,
  agentsThreadDelete,
  agentsThreadUpdateTitle,
  agentsMessagesList,
  agentsMessageInsert,
  agentsResolveDefault,
  agentsUpsertDefault,
  agentsSeedGrammarFix,
  agentsSeedEmojiFallback,
} from '../../lib/ipc/commands';
import { feedbackService } from '../../services/feedback/feedbackService.svelte';
import { settingsService } from '../../services/settings/settingsService.svelte';
import type {
  AgentDef,
  AgentCreateInput,
  AgentUpdateInput,
  ThreadDef,
  MessageDef,
  MessageInsertInput,
} from './types';
import { appListen } from '../../lib/ipc/bridgeEvents';

function reportAgentFailure(kind: string, operation: string, error: unknown): void {
  feedbackService.report({
    source: 'frontend',
    kind,
    severity: 'error',
    retryable: false,
    developerDetail: `${operation} failed: ${error instanceof Error ? error.message : String(error)}`,
  });
}

// Tracks the most-recently-constructed AgentService instance.
// Dispatch functions use this so that test code creating `new AgentService()`
// for setup is automatically visible to the dispatch layer without requiring
// a separate mock of the module singleton.
let _currentInstance: AgentService | undefined;

/** Returns the most-recently-constructed AgentService instance. */
export function getCurrentAgentService(): AgentService {
  return _currentInstance!;
}

export class AgentService {
  agents = $state<AgentDef[]>([]);
  defaultAgent = $state<AgentDef | null>(null);
  private initialized = false;

  constructor() {
    _currentInstance = this;
    void appListen('agents:changed', () => {
      void this.refresh();
    })?.catch(() => {
      // No-op outside Tauri runtime (e.g. unit-test environments).
    });
  }

  async refresh(): Promise<void> {
    let list: AgentDef[];
    try {
      list = await agentsList();
    } catch (error) {
      reportAgentFailure('agents_load_failed', 'agents_list', error);
      return;
    }
    this.agents = list;
    this.defaultAgent = await agentsResolveDefault(
      settingsService.currentSettings.ai.defaultAgentId,
    );
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    let list: AgentDef[];
    try {
      list = await agentsList();
    } catch (error) {
      reportAgentFailure('agents_load_failed', 'agents_list', error);
      throw error;
    }
    this.agents = list;
    this.defaultAgent = await agentsResolveDefault(
      settingsService.currentSettings.ai.defaultAgentId,
    );
    this.initialized = true;
  }

  async create(input: AgentCreateInput): Promise<AgentDef> {
    let row: AgentDef;
    try {
      row = await agentsCreate(input);
    } catch (error) {
      reportAgentFailure('agents_create_failed', 'agents_create', error);
      throw error;
    }
    this.agents = [...this.agents, row];
    return row;
  }

  async update(input: AgentUpdateInput): Promise<AgentDef> {
    let row: AgentDef;
    try {
      row = await agentsUpdate(input);
    } catch (error) {
      reportAgentFailure('agents_update_failed', 'agents_update', error);
      throw error;
    }
    this.agents = this.agents.map((a) => (a.id === row.id ? row : a));
    return row;
  }

  async delete(id: string): Promise<void> {
    try {
      await agentsDelete(id);
    } catch (error) {
      reportAgentFailure('agents_delete_failed', 'agents_delete', error);
      throw error;
    }
    this.agents = this.agents.filter((a) => a.id !== id);
  }

  getById(id: string): AgentDef | undefined {
    return this.agents.find((a) => a.id === id);
  }

  getDefaultAgent(): AgentDef | null {
    return this.defaultAgent;
  }

  /**
   * Ensures there is a default agent reflecting the given provider and model.
   * If a default agent already exists, updates its providerId and modelId.
   * If none exists, creates a new one and writes its id to settings.ai.defaultAgentId.
   */
  async upsertDefaultAgent(providerId: string, modelId: string): Promise<AgentDef> {
    const existingId = settingsService.currentSettings.ai.defaultAgentId;
    const row = await agentsUpsertDefault(existingId, providerId, modelId);
    this.defaultAgent = row;
    if (existingId !== row.id) {
      await settingsService.updateSettings('ai', { defaultAgentId: row.id });
    }
    return row;
  }

  /**
   * Seed the bundled "Grammar Fix" silent agent if it isn't already present.
   * Pure agent creation only — the caller is responsible for binding any
   * hotkey via `shortcutService.register` after this resolves. Keeping the
   * shortcut bind out of this method avoids pulling the shortcut layer
   * (and its transitive `extensionManager` import) into the agent service
   * module graph.
   *
   * Idempotent: if an agent named "Grammar Fix" already exists, the existing
   * record is returned untouched and no new SQLite row is written.
   */
  async seedGrammarFixAgent(providerId: string, modelId: string): Promise<AgentDef> {
    return agentsSeedGrammarFix(providerId, modelId);
  }

  async seedEmojiFallbackAgent(providerId: string, modelId: string): Promise<AgentDef> {
    return agentsSeedEmojiFallback(providerId, modelId);
  }

  async listThreads(agentId: string): Promise<ThreadDef[]> {
    return agentsThreadsList(agentId);
  }

  async createThread(
    agentId: string,
    title?: string | null,
    isPinned?: boolean,
  ): Promise<ThreadDef> {
    const retentionCap = settingsService.currentSettings.ai.historyRetentionCap ?? 100;
    return agentsThreadCreate(agentId, title, isPinned, retentionCap);
  }

  async setThreadPinned(id: string, pinned: boolean): Promise<void> {
    await agentsThreadSetPinned(id, pinned);
  }

  async pruneThreads(cap?: number, activeThreadId?: string): Promise<number> {
    const effectiveCap = cap ?? settingsService.currentSettings.ai.historyRetentionCap ?? 100;
    return agentsThreadsPrune(effectiveCap, activeThreadId ?? null);
  }

  async deleteThread(id: string): Promise<void> {
    await agentsThreadDelete(id);
  }

  async updateThreadTitle(id: string, title: string): Promise<void> {
    await agentsThreadUpdateTitle(id, title);
  }

  async listMessages(threadId: string): Promise<MessageDef[]> {
    return agentsMessagesList(threadId);
  }

  async insertMessage(input: MessageInsertInput): Promise<MessageDef> {
    return agentsMessageInsert(input);
  }
}

export const agentService = new AgentService();
