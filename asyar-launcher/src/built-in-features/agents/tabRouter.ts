import type { AgentDef } from './types';

export type TabDestination = { kind: 'agent'; agentId: string | null };

export interface TabDestinationInput {
  defaultAgentId: string | null;
  agents: AgentDef[];
}

export function decideTabDestination(opts: TabDestinationInput): TabDestination {
  if (opts.agents.length === 0) return { kind: 'agent', agentId: null };
  if (opts.defaultAgentId) {
    const match = opts.agents.find((a) => a.id === opts.defaultAgentId);
    if (match) return { kind: 'agent', agentId: match.id };
  }
  return { kind: 'agent', agentId: opts.agents[0].id };
}
