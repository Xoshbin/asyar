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
import { diagnosticsService } from '../../services/diagnostics/diagnosticsService.svelte';
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
