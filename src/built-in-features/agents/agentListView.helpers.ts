import type { AgentDef } from './types';

export interface AgentRowProps {
  title: string;
  subtitle: string;
}

export interface DeleteDeps {
  service: { delete(id: string): Promise<void> };
  manager: { refresh(): Promise<void> };
}

export interface ChatNavDeps {
  manager: { currentAgentId: string | null };
  viewManager: { navigateToView(path: string): void };
}

export interface EditNavDeps {
  manager: { currentAgentId: string | null };
  viewManager: { navigateToView(path: string): void };
}

export interface NewAgentDeps {
  manager: { currentAgentId: string | null };
  viewManager: { navigateToView(path: string): void };
}

export function buildAgentRowProps(agent: AgentDef): AgentRowProps {
  const subtitle =
    agent.description && agent.description.length > 0
      ? agent.description
      : `${agent.providerId} · ${agent.modelId}`;
  return { title: agent.name, subtitle };
}

export async function handleDeleteAgent(agentId: string, deps: DeleteDeps): Promise<void> {
  await deps.service.delete(agentId);
  await deps.manager.refresh();
}

export function handleSelectAgentForChat(agentId: string, deps: ChatNavDeps): void {
  deps.manager.currentAgentId = agentId;
  deps.viewManager.navigateToView('agents/AgentChatView');
}

export function handleSelectAgentForEdit(agentId: string, deps: EditNavDeps): void {
  deps.manager.currentAgentId = agentId;
  deps.viewManager.navigateToView('agents/AgentEditView');
}

export function handleNewAgent(deps: NewAgentDeps): void {
  deps.manager.currentAgentId = null;
  deps.viewManager.navigateToView('agents/AgentEditView');
}
