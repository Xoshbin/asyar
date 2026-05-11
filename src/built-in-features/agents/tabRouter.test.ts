import { describe, it, expect } from 'vitest';
import type { AgentDef } from './types';
import { decideTabDestination } from './tabRouter';

function makeAgent(overrides: Partial<AgentDef> = {}): AgentDef {
  return {
    id: 'a',
    name: 'A',
    description: null,
    systemPrompt: '',
    providerId: 'openai',
    modelId: 'gpt-4o-mini',
    toolSelection: [],
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe('decideTabDestination', () => {
  it('returns agentId null when no agents exist', () => {
    expect(decideTabDestination({ defaultAgentId: null, agents: [] })).toEqual({
      kind: 'agent',
      agentId: null,
    });
    expect(decideTabDestination({ defaultAgentId: 'ghost', agents: [] })).toEqual({
      kind: 'agent',
      agentId: null,
    });
  });

  it('returns the matching agent when defaultAgentId resolves', () => {
    const agentA = makeAgent({ id: 'agent-a', name: 'A' });
    const agentB = makeAgent({ id: 'agent-b', name: 'B' });
    const result = decideTabDestination({
      defaultAgentId: 'agent-b',
      agents: [agentA, agentB],
    });
    expect(result).toEqual({ kind: 'agent', agentId: 'agent-b' });
  });

  it('falls back to the first agent when defaultAgentId is null or ghost', () => {
    const agentA = makeAgent({ id: 'agent-a', name: 'A' });
    const agentB = makeAgent({ id: 'agent-b', name: 'B' });
    expect(
      decideTabDestination({ defaultAgentId: null, agents: [agentA, agentB] }),
    ).toEqual({ kind: 'agent', agentId: 'agent-a' });

    const agentC = makeAgent({ id: 'agent-c', name: 'C' });
    expect(
      decideTabDestination({ defaultAgentId: 'ghost', agents: [agentC] }),
    ).toEqual({ kind: 'agent', agentId: 'agent-c' });
  });
});
