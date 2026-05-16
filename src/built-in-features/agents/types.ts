export type MessageRole = 'user' | 'assistant' | 'tool'

/**
 * Where the silent-AI dispatcher pulls the input text from before calling
 * the LLM. Meaningless when `AgentDef.silent === false`.
 */
export type SilentInputSource = 'selection' | 'clipboard' | 'argument' | 'none'

/**
 * What the silent-AI dispatcher does with the LLM's final assistant message.
 * Meaningless when `AgentDef.silent === false`.
 */
export type SilentOutputAction = 'replaceSelection' | 'copy' | 'paste' | 'hud'

export interface AgentDef {
  id: string
  name: string
  description: string | null
  systemPrompt: string
  providerId: string
  modelId: string
  toolSelection: string[]
  /**
   * When true, dispatching this agent skips the chat view, runs a single-turn
   * loop headlessly, and applies `outputAction` to the result.
   */
  silent: boolean
  /** Where to capture the user-text payload from. Ignored when silent=false. */
  inputSource: SilentInputSource
  /** What to do with the LLM's final text. Ignored when silent=false. */
  outputAction: SilentOutputAction
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
  /** Optional. Defaults to false in the Rust layer when omitted. */
  silent?: boolean
  /** Optional. Defaults to `'argument'` in the Rust layer when omitted. */
  inputSource?: SilentInputSource
  /** Optional. Defaults to `'replaceSelection'` in the Rust layer when omitted. */
  outputAction?: SilentOutputAction
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
