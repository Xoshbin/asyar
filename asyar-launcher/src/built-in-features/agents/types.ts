export type MessageRole = 'user' | 'assistant' | 'tool'

export interface AgentDef {
  id: string
  name: string
  description: string | null
  systemPrompt: string
  providerId: string
  modelId: string
  toolSelection: string[]
  createdAt: number | null
  updatedAt: number | null
}

export interface ThreadDef {
  id: string
  agentId: string
  title: string | null
  createdAt: number | null
  updatedAt: number | null
}

export interface MessageDef {
  id: string
  threadId: string
  role: MessageRole
  content: unknown
  createdAt: number
  runId: string | null
}

export interface AgentCreateInput {
  name: string
  description?: string | null
  systemPrompt: string
  providerId: string
  modelId: string
  toolSelection: string[]
}

export interface AgentUpdateInput extends AgentCreateInput {
  id: string
}

export interface MessageInsertInput {
  threadId: string
  role: MessageRole
  content: unknown
  runId?: string | null
}
