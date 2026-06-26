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
    const list = await agentsList();
    if (list === null) {
      diagnosticsService.report({
        source: 'frontend',
        kind: 'agents_load_failed',
        severity: 'error',
        retryable: false,
        developerDetail: 'agents_list returned null',
      });
      return;
    }
    this.agents = list;
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    const list = await agentsList();
    if (list === null) {
      diagnosticsService.report({
        source: 'frontend',
        kind: 'agents_load_failed',
        severity: 'error',
        retryable: false,
        developerDetail: 'agents_list returned null',
      });
      throw new Error('Failed to load agents');
    }
    this.agents = list;
    this.initialized = true;
  }

  async create(input: AgentCreateInput): Promise<AgentDef> {
    const row = await agentsCreate(input);
    if (row === null) {
      diagnosticsService.report({
        source: 'frontend',
        kind: 'agents_create_failed',
        severity: 'error',
        retryable: false,
        developerDetail: 'agents_create returned null',
      });
      throw new Error('Failed to create agent');
    }
    this.agents = [...this.agents, row];
    return row;
  }

  async update(input: AgentUpdateInput): Promise<AgentDef> {
    const row = await agentsUpdate(input);
    if (row === null) {
      diagnosticsService.report({
        source: 'frontend',
        kind: 'agents_update_failed',
        severity: 'error',
        retryable: false,
        developerDetail: 'agents_update returned null',
      });
      throw new Error('Failed to update agent');
    }
    this.agents = this.agents.map((a) => (a.id === row.id ? row : a));
    return row;
  }

  async delete(id: string): Promise<void> {
    const ok = await agentsDelete(id);
    if (!ok) {
      diagnosticsService.report({
        source: 'frontend',
        kind: 'agents_delete_failed',
        severity: 'error',
        retryable: false,
        developerDetail: 'agents_delete returned false',
      });
      throw new Error('Failed to delete agent');
    }
    this.agents = this.agents.filter((a) => a.id !== id);
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
    const result = await agentsThreadsList(agentId);
    if (result === null) throw new Error('Failed to list agent threads');
    return result;
  }

  async createThread(agentId: string, title?: string | null): Promise<ThreadDef> {
    const result = await agentsThreadCreate(agentId, title);
    if (result === null) throw new Error('Failed to create agent thread');
    return result;
  }

  async deleteThread(id: string): Promise<void> {
    await agentsThreadDelete(id);
  }

  async updateThreadTitle(id: string, title: string): Promise<void> {
    await agentsThreadUpdateTitle(id, title);
  }

  async listMessages(threadId: string): Promise<MessageDef[]> {
    const result = await agentsMessagesList(threadId);
    if (result === null) throw new Error('Failed to list agent messages');
    return result;
  }

  async insertMessage(input: MessageInsertInput): Promise<MessageDef> {
    const result = await agentsMessageInsert(input);
    if (result === null) throw new Error('Failed to insert agent message');
    return result;
  }
}

export const agentService = new AgentService();
