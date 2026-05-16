import {
  agentsList,
  agentsCreate,
  agentsUpdate,
  agentsDelete,
  agentsThreadsList,
  agentsThreadCreate,
  agentsThreadDelete,
  agentsThreadUpdateTitle,
  agentsMessagesList,
  agentsMessageInsert,
} from '../../lib/ipc/commands';
import { listen } from '@tauri-apps/api/event';
import { diagnosticsService } from '../../services/diagnostics/diagnosticsService.svelte';
import { settingsService } from '../../services/settings/settingsService.svelte';
import { buildDefaultAgentInput, buildGrammarFixAgentInput } from './defaultAgent';
import { logService } from '../../services/log/logService';
import type {
  AgentDef,
  AgentCreateInput,
  AgentUpdateInput,
  ThreadDef,
  MessageDef,
  MessageInsertInput,
} from './types';

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
  private initialized = false;

  constructor() {
    _currentInstance = this;
    void listen('agents:changed', () => {
      void this.refresh();
    }).catch(() => {
      // No-op outside Tauri runtime (e.g. unit-test environments).
    });
  }

  async refresh(): Promise<void> {
    try {
      const list = await agentsList();
      this.agents = list;
    } catch (err) {
      diagnosticsService.report({
        source: 'frontend',
        kind: 'agents_load_failed',
        severity: 'error',
        retryable: false,
        developerDetail: String(err),
      });
    }
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    try {
      const list = await agentsList();
      this.agents = list;
      this.initialized = true;
    } catch (err) {
      diagnosticsService.report({
        source: 'frontend',
        kind: 'agents_load_failed',
        severity: 'error',
        retryable: false,
        developerDetail: String(err),
      });
      throw err;
    }
  }

  async create(input: AgentCreateInput): Promise<AgentDef> {
    try {
      const row = await agentsCreate(input);
      this.agents = [...this.agents, row];
      return row;
    } catch (err) {
      diagnosticsService.report({
        source: 'frontend',
        kind: 'agents_create_failed',
        severity: 'error',
        retryable: false,
        developerDetail: String(err),
      });
      throw err;
    }
  }

  async update(input: AgentUpdateInput): Promise<AgentDef> {
    try {
      const row = await agentsUpdate(input);
      this.agents = this.agents.map((a) => (a.id === row.id ? row : a));
      return row;
    } catch (err) {
      diagnosticsService.report({
        source: 'frontend',
        kind: 'agents_update_failed',
        severity: 'error',
        retryable: false,
        developerDetail: String(err),
      });
      throw err;
    }
  }

  async delete(id: string): Promise<void> {
    try {
      await agentsDelete(id);
      this.agents = this.agents.filter((a) => a.id !== id);
    } catch (err) {
      diagnosticsService.report({
        source: 'frontend',
        kind: 'agents_delete_failed',
        severity: 'error',
        retryable: false,
        developerDetail: String(err),
      });
      throw err;
    }
  }

  getById(id: string): AgentDef | undefined {
    return this.agents.find((a) => a.id === id);
  }

  getDefaultAgent(): AgentDef | null {
    const id = settingsService.currentSettings.ai.defaultAgentId;
    if (id) {
      const match = this.getById(id);
      if (match) return match;
    }
    return this.agents[0] ?? null;
  }

  async getOrCreateDefaultAgent(providerId: string, modelId: string): Promise<AgentDef> {
    const existingId = settingsService.currentSettings.ai.defaultAgentId;
    if (existingId) {
      const existing = this.getById(existingId);
      if (existing) return existing;
    }
    const created = await this.create(buildDefaultAgentInput(providerId, modelId));
    await settingsService.updateSettings('ai', { defaultAgentId: created.id });
    return created;
  }

  /**
   * Ensures there is a default agent reflecting the given provider and model.
   * If a default agent already exists, updates its providerId and modelId.
   * If none exists, creates a new one and writes its id to settings.ai.defaultAgentId.
   */
  async upsertDefaultAgent(providerId: string, modelId: string): Promise<AgentDef> {
    const existingId = settingsService.currentSettings.ai.defaultAgentId;
    if (existingId) {
      const existing = this.getById(existingId);
      if (existing) {
        return this.update({
          id: existing.id,
          name: existing.name,
          description: existing.description ?? null,
          systemPrompt: existing.systemPrompt,
          providerId,
          modelId,
          toolSelection: existing.toolSelection,
        });
      }
    }
    const created = await this.create(buildDefaultAgentInput(providerId, modelId));
    await settingsService.updateSettings('ai', { defaultAgentId: created.id });
    return created;
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
    const existing = this.agents.find((a) => a.name === 'Grammar Fix');
    if (existing) {
      logService.debug('[agents] Grammar Fix already seeded; skipping');
      return existing;
    }
    return this.create(buildGrammarFixAgentInput(providerId, modelId));
  }

  async listThreads(agentId: string): Promise<ThreadDef[]> {
    return agentsThreadsList(agentId);
  }

  async createThread(agentId: string, title?: string | null): Promise<ThreadDef> {
    return agentsThreadCreate(agentId, title);
  }

  async deleteThread(id: string): Promise<void> {
    return agentsThreadDelete(id);
  }

  async updateThreadTitle(id: string, title: string): Promise<void> {
    return agentsThreadUpdateTitle(id, title);
  }

  async listMessages(threadId: string): Promise<MessageDef[]> {
    return agentsMessagesList(threadId);
  }

  async insertMessage(input: MessageInsertInput): Promise<MessageDef> {
    return agentsMessageInsert(input);
  }
}

export const agentService = new AgentService();
