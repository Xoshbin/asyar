import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  buildAgentRowProps,
  handleDeleteAgent,
  handleSelectAgentForChat,
  handleSelectAgentForEdit,
  handleNewAgent,
} from './agentListView.helpers';

import type { AgentDef } from './types';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const makeAgent = (over: Partial<AgentDef> = {}): AgentDef => ({
  id: 'a1',
  name: 'My Agent',
  description: null,
  systemPrompt: 'You are helpful.',
  providerId: 'openai',
  modelId: 'gpt-4',
  toolSelection: [],
  createdAt: 1000,
  updatedAt: 1000,
  ...over,
});

// ── buildAgentRowProps ────────────────────────────────────────────────────────

describe('buildAgentRowProps', () => {
  it('uses agent name as title', () => {
    const props = buildAgentRowProps(makeAgent({ name: 'Summariser' }));
    expect(props.title).toBe('Summariser');
  });

  it('uses description as subtitle when present', () => {
    const props = buildAgentRowProps(
      makeAgent({ description: 'Summarises documents', providerId: 'openai', modelId: 'gpt-4' }),
    );
    expect(props.subtitle).toBe('Summarises documents');
  });

  it('subtitle falls back to provider + model when description is null', () => {
    const props = buildAgentRowProps(
      makeAgent({ description: null, providerId: 'anthropic', modelId: 'claude-3-5-sonnet' }),
    );
    expect(props.subtitle).toBe('anthropic · claude-3-5-sonnet');
  });

  it('subtitle falls back to provider + model when description is empty string', () => {
    const props = buildAgentRowProps(
      makeAgent({ description: '', providerId: 'openai', modelId: 'gpt-4o' }),
    );
    expect(props.subtitle).toBe('openai · gpt-4o');
  });
});

// ── handleDeleteAgent ─────────────────────────────────────────────────────────

describe('handleDeleteAgent', () => {
  it('calls service.delete with the agent id', async () => {
    const service = { delete: vi.fn().mockResolvedValue(undefined) };
    const manager = { refresh: vi.fn().mockResolvedValue(undefined) };

    await handleDeleteAgent('a1', { service, manager });

    expect(service.delete).toHaveBeenCalledWith('a1');
  });

  it('calls manager.refresh after service.delete', async () => {
    const callOrder: string[] = [];
    const service = {
      delete: vi.fn().mockImplementation(async () => {
        callOrder.push('delete');
      }),
    };
    const manager = {
      refresh: vi.fn().mockImplementation(async () => {
        callOrder.push('refresh');
      }),
    };

    await handleDeleteAgent('a1', { service, manager });

    expect(callOrder).toEqual(['delete', 'refresh']);
  });
});

// ── handleSelectAgentForChat ──────────────────────────────────────────────────

describe('handleSelectAgentForChat', () => {
  it('sets manager.currentAgentId to the given id', () => {
    const manager = { currentAgentId: null as string | null };
    const viewMgr = { navigateToView: vi.fn() };

    handleSelectAgentForChat('agent-42', { manager, viewManager: viewMgr });

    expect(manager.currentAgentId).toBe('agent-42');
  });

  it('navigates to agents/AgentChatView', () => {
    const manager = { currentAgentId: null as string | null };
    const viewMgr = { navigateToView: vi.fn() };

    handleSelectAgentForChat('agent-42', { manager, viewManager: viewMgr });

    expect(viewMgr.navigateToView).toHaveBeenCalledWith('agents/AgentChatView');
  });
});

// ── handleSelectAgentForEdit ──────────────────────────────────────────────────

describe('handleSelectAgentForEdit', () => {
  it('sets manager.currentAgentId to the given id', () => {
    const manager = { currentAgentId: null as string | null };
    const viewMgr = { navigateToView: vi.fn() };

    handleSelectAgentForEdit('agent-7', { manager, viewManager: viewMgr });

    expect(manager.currentAgentId).toBe('agent-7');
  });

  it('navigates to agents/AgentEditView', () => {
    const manager = { currentAgentId: null as string | null };
    const viewMgr = { navigateToView: vi.fn() };

    handleSelectAgentForEdit('agent-7', { manager, viewManager: viewMgr });

    expect(viewMgr.navigateToView).toHaveBeenCalledWith('agents/AgentEditView');
  });
});

// ── handleNewAgent ────────────────────────────────────────────────────────────

describe('handleNewAgent', () => {
  it('sets manager.currentAgentId to null (create mode)', () => {
    const manager = { currentAgentId: 'existing-id' as string | null };
    const viewMgr = { navigateToView: vi.fn() };

    handleNewAgent({ manager, viewManager: viewMgr });

    expect(manager.currentAgentId).toBeNull();
  });

  it('navigates to agents/AgentEditView', () => {
    const manager = { currentAgentId: null as string | null };
    const viewMgr = { navigateToView: vi.fn() };

    handleNewAgent({ manager, viewManager: viewMgr });

    expect(viewMgr.navigateToView).toHaveBeenCalledWith('agents/AgentEditView');
  });
});
