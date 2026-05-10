import { describe, it, expect, vi, beforeEach } from 'vitest';

// All mocks must be declared before any import of the module under test.

vi.mock('../../services/ai/providerRegistry', () => ({
  getProvider: vi.fn(),
}));

vi.mock('../../services/ai/aiEngine', () => ({
  streamChat: vi.fn(),
}));

vi.mock('../../services/settings/settingsService.svelte', () => ({
  settingsService: {
    getSettings: vi.fn(),
  },
}));

vi.mock('./agentService.svelte', () => ({
  agentService: {
    getById: vi.fn(),
    insertMessage: vi.fn(),
    listMessages: vi.fn(),
  },
}));

vi.mock('../../lib/ipc/commands', () => ({
  agentsGet: vi.fn(),
  agentsToolsList: vi.fn(),
}));

vi.mock('./toolDispatch', () => ({
  invokeTool: vi.fn(),
}));

vi.mock('../../services/diagnostics/diagnosticsService.svelte', () => ({
  diagnosticsService: { report: vi.fn() },
}));

vi.mock('../../services/run/runService.svelte', () => ({
  runService: {
    startLocal: vi.fn(),
  },
}));

import { runAgent, encodeToolIdForWire, coalesceConsecutiveSameRole } from './agentLoop';
import { getProvider } from '../../services/ai/providerRegistry';
import { streamChat } from '../../services/ai/aiEngine';
import { settingsService } from '../../services/settings/settingsService.svelte';
import { agentService } from './agentService.svelte';
import * as commands from '../../lib/ipc/commands';
import { diagnosticsService } from '../../services/diagnostics/diagnosticsService.svelte';
import { invokeTool } from './toolDispatch';
import { runService } from '../../services/run/runService.svelte';
import type { LocalRunHandle } from '../../services/run/runService.svelte';

// ── Fixtures ───────────────────────────────────────────────────────────────────

type FakeHandle = LocalRunHandle & { _cancelCallbacks: Array<() => void> };

function makeFakeHandle(): FakeHandle {
  const cbs: Array<() => void> = [];
  return {
    id: 'run-fake-1',
    write: vi.fn().mockResolvedValue(undefined),
    done: vi.fn().mockResolvedValue(undefined),
    fail: vi.fn().mockResolvedValue(undefined),
    cancel: vi.fn().mockResolvedValue(undefined),
    onCancel: vi.fn((cb: () => void) => {
      cbs.push(cb);
      return () => { /* unsub */ };
    }),
    _cancelCallbacks: cbs,
  };
}

const makeAgent = (over: Record<string, unknown> = {}) => ({
  id: 'a1',
  name: 'Test Agent',
  description: null,
  systemPrompt: '',
  providerId: 'openai',
  modelId: 'gpt-4o',
  toolSelection: [],
  createdAt: 1000,
  updatedAt: 1000,
  ...over,
});

const makeSettings = (apiKey = 'sk-test') => ({
  ai: {
    providers: {
      openai: { enabled: true, apiKey },
    },
    temperature: 0.7,
    maxTokens: 2048,
    activeProviderId: 'openai',
    activeModelId: 'gpt-4o',
    allowExtensionUse: true,
  },
});

const makePlugin = () => ({
  id: 'openai' as const,
  name: 'OpenAI',
  requiresApiKey: true,
  requiresBaseUrl: false,
  optionalApiKey: false,
  getModels: vi.fn(),
  buildRequest: vi.fn(),
  parseStream: vi.fn(),
});

/**
 * A tool-capable plugin variant used only in Item 9 tests.
 * `parseToolStream` returns an async generator of ToolStreamEvent objects.
 */
type ToolStreamEvent =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'message_stop' };

async function* makeAsyncGen(events: ToolStreamEvent[]): AsyncGenerator<ToolStreamEvent> {
  for (const e of events) {
    yield e;
  }
}

const makeToolPlugin = (overrides: Record<string, unknown> = {}) => ({
  id: 'anthropic' as const,
  name: 'Anthropic',
  requiresApiKey: true,
  requiresBaseUrl: false,
  optionalApiKey: false,
  supportsTools: true,
  getModels: vi.fn(),
  buildRequest: vi.fn(),
  parseStream: vi.fn(),
  buildToolRequest: vi.fn(),
  parseToolStream: vi.fn(),
  ...overrides,
});

const makeToolDescriptor = (
  fqid: string,
  over: Record<string, unknown> = {},
) => ({
  id: fqid.split(':')[1],
  name: fqid.split(':')[1],
  description: 'A test tool',
  parameters: {},
  source: fqid.startsWith('builtin') ? ('builtin' as const) : { extensionId: fqid.split(':')[0] },
  fullyQualifiedId: fqid,
  ...over,
});

const makeMessage = (over: Record<string, unknown> = {}) => ({
  id: 'm1',
  threadId: 't1',
  role: 'user' as const,
  content: { text: 'hello' },
  createdAt: 3000,
  runId: null,
  ...over,
});

/**
 * Wire up `streamChat` to call handlers.onToken for each token in the array,
 * then call handlers.onDone.
 */
function mockStreamChatTokens(tokens: string[]) {
  vi.mocked(streamChat).mockImplementation(
    async (_plugin, _config, _messages, _params, handlers) => {
      for (const token of tokens) {
        handlers.onToken(token);
      }
      handlers.onDone();
    },
  );
}

/**
 * Wire up `streamChat` to call handlers.onToken for each token in the array,
 * then call handlers.onError.
 */
function mockStreamChatError(tokens: string[], errorMsg: string) {
  vi.mocked(streamChat).mockImplementation(
    async (_plugin, _config, _messages, _params, handlers) => {
      for (const token of tokens) {
        handlers.onToken(token);
      }
      handlers.onError(errorMsg);
    },
  );
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('runAgent', () => {
  let fakeHandle: FakeHandle;

  beforeEach(() => {
    vi.clearAllMocks();

    // Default happy-path wiring
    vi.mocked(agentService.getById).mockReturnValue(makeAgent() as never);
    vi.mocked(getProvider).mockReturnValue(makePlugin() as never);
    vi.mocked(settingsService.getSettings).mockReturnValue(makeSettings() as never);
    vi.mocked(agentService.insertMessage).mockResolvedValue(makeMessage() as never);
    vi.mocked(agentService.listMessages).mockResolvedValue([makeMessage()] as never);
    mockStreamChatTokens(['Hello', ' world']);

    // Run service mock: always resolves with a fresh fake handle
    fakeHandle = makeFakeHandle();
    vi.mocked(runService.startLocal).mockResolvedValue(fakeHandle as unknown as LocalRunHandle);
  });

  // 1 ── Happy path: persists user then assistant messages ────────────────────

  it('runAgent_persists_user_then_assistant_messages', async () => {
    await runAgent({ agentId: 'a1', threadId: 't1', userText: 'hi there' });

    const calls = vi.mocked(agentService.insertMessage).mock.calls;
    expect(calls.length).toBeGreaterThanOrEqual(2);

    const userCall = calls[0][0];
    expect(userCall.role).toBe('user');
    expect(userCall.threadId).toBe('t1');
    expect((userCall.content as { text: string }).text).toBe('hi there');

    const assistantCall = calls[1][0];
    expect(assistantCall.role).toBe('assistant');
    expect((assistantCall.content as { text: string }).text).toBe('Hello world');
  });

  // 2 ── Throws when agent missing ───────────────────────────────────────────

  it('runAgent_throws_when_agent_missing', async () => {
    vi.mocked(agentService.getById).mockReturnValue(undefined);
    vi.mocked(commands.agentsGet).mockResolvedValue(null as never);

    await expect(runAgent({ agentId: 'ghost', threadId: 't1', userText: 'hi' })).rejects.toThrow(
      /ghost/,
    );
  });

  // 3 ── Throws when provider missing ────────────────────────────────────────

  it('runAgent_throws_when_provider_missing', async () => {
    vi.mocked(agentService.getById).mockReturnValue(makeAgent({ providerId: 'unknown' }) as never);
    vi.mocked(getProvider).mockReturnValue(undefined);

    await expect(runAgent({ agentId: 'a1', threadId: 't1', userText: 'hi' })).rejects.toThrow(
      /unknown/,
    );
  });

  // 4 ── Throws when apiKey missing ──────────────────────────────────────────

  it('runAgent_throws_when_apiKey_missing', async () => {
    vi.mocked(settingsService.getSettings).mockReturnValue(makeSettings('') as never);

    await expect(runAgent({ agentId: 'a1', threadId: 't1', userText: 'hi' })).rejects.toThrow();
    expect(diagnosticsService.report).toHaveBeenCalled();
  });

  // 5 ── Includes systemPrompt as system message ─────────────────────────────

  it('runAgent_includes_systemPrompt_as_system_message', async () => {
    vi.mocked(agentService.getById).mockReturnValue(
      makeAgent({ systemPrompt: 'You are helpful' }) as never,
    );
    vi.mocked(agentService.listMessages).mockResolvedValue([] as never);

    await runAgent({ agentId: 'a1', threadId: 't1', userText: 'hi' });

    const streamChatCall = vi.mocked(streamChat).mock.calls[0];
    const chatMessages = streamChatCall[2];
    expect(chatMessages[0].role).toBe('system');
    expect(chatMessages[0].content).toBe('You are helpful');
  });

  // 6 ── Passes full thread history to provider in correct order ─────────────

  it('runAgent_passes_thread_history_to_provider', async () => {
    const priorUser = makeMessage({ id: 'p1', role: 'user', content: { text: 'first' }, createdAt: 1000 });
    const priorAssistant = makeMessage({
      id: 'p2',
      role: 'assistant',
      content: { text: 'second' },
      createdAt: 2000,
    });
    const newUser = makeMessage({ id: 'p3', role: 'user', content: { text: 'hi' }, createdAt: 3000 });

    // listMessages returns all 3 (2 prior + new user already inserted)
    vi.mocked(agentService.listMessages).mockResolvedValue([priorUser, priorAssistant, newUser] as never);
    vi.mocked(agentService.getById).mockReturnValue(
      makeAgent({ systemPrompt: 'You are helpful' }) as never,
    );

    await runAgent({ agentId: 'a1', threadId: 't1', userText: 'hi' });

    const streamChatCall = vi.mocked(streamChat).mock.calls[0];
    const chatMessages = streamChatCall[2];

    // Order: system, prior user, prior assistant, new user
    expect(chatMessages[0].role).toBe('system');
    expect(chatMessages[1].role).toBe('user');
    expect(chatMessages[1].content).toBe('first');
    expect(chatMessages[2].role).toBe('assistant');
    expect(chatMessages[2].content).toBe('second');
    expect(chatMessages[3].role).toBe('user');
    expect(chatMessages[3].content).toBe('hi');
  });

  // 7 ── Persists partial assistant message on stream error ──────────────────

  it('runAgent_persists_partial_assistant_message_on_stream_error', async () => {
    mockStreamChatError(['first-token'], 'stream died');

    await expect(runAgent({ agentId: 'a1', threadId: 't1', userText: 'hi' })).rejects.toThrow();

    const calls = vi.mocked(agentService.insertMessage).mock.calls;
    const assistantCall = calls.find((c) => c[0].role === 'assistant');
    expect(assistantCall).toBeDefined();
    expect((assistantCall![0].content as { text: string }).text).toBe('first-token');

    expect(diagnosticsService.report).toHaveBeenCalled();
  });

  // 8 ── Does not persist assistant message when no tokens received ──────────

  it('runAgent_does_not_persist_assistant_message_when_no_tokens_received', async () => {
    mockStreamChatError([], 'immediate error');

    await expect(runAgent({ agentId: 'a1', threadId: 't1', userText: 'hi' })).rejects.toThrow();

    const calls = vi.mocked(agentService.insertMessage).mock.calls;
    const assistantCall = calls.find((c) => c[0].role === 'assistant');
    expect(assistantCall).toBeUndefined();
  });

  // 9 ── Uses agent modelId in request params ────────────────────────────────

  it('runAgent_uses_agent_modelId_in_request_params', async () => {
    vi.mocked(agentService.getById).mockReturnValue(
      makeAgent({ modelId: 'claude-3-5-sonnet' }) as never,
    );

    await runAgent({ agentId: 'a1', threadId: 't1', userText: 'hi' });

    const streamChatCall = vi.mocked(streamChat).mock.calls[0];
    const params = streamChatCall[3];
    expect(params.modelId).toBe('claude-3-5-sonnet');
  });

  // 10 ── Falls back to agentsGet IPC when not in cache ─────────────────────

  it('runAgent_falls_back_to_agentsGet_when_not_in_cache', async () => {
    const fetchedAgent = makeAgent({ id: 'a99' });
    vi.mocked(agentService.getById).mockReturnValue(undefined);
    vi.mocked(commands.agentsGet).mockResolvedValue(fetchedAgent as never);

    await runAgent({ agentId: 'a99', threadId: 't1', userText: 'hi' });

    expect(commands.agentsGet).toHaveBeenCalledWith('a99');
  });

  // ── Item 9: tool-calling paths ─────────────────────────────────────────────

  // 11 ── Text-only path when toolSelection is empty ─────────────────────────

  it('runAgent_text_only_when_toolSelection_empty', async () => {
    // agent has empty toolSelection, even with a tool-capable plugin
    vi.mocked(agentService.getById).mockReturnValue(makeAgent({ toolSelection: [] }) as never);
    vi.mocked(getProvider).mockReturnValue(makeToolPlugin() as never);
    mockStreamChatTokens(['Hello', ' world']);

    await runAgent({ agentId: 'a1', threadId: 't1', userText: 'hi' });

    // streamChat (text path) must be called
    expect(streamChat).toHaveBeenCalled();
    // parseToolStream must NOT be called
    const plugin = vi.mocked(getProvider).mock.results[0].value as ReturnType<typeof makeToolPlugin>;
    expect(plugin.parseToolStream).not.toHaveBeenCalled();
    // invokeTool must NOT be called
    expect(invokeTool).not.toHaveBeenCalled();
  });

  // 12 ── Rejects when tools selected but provider does not support tools ─────

  it('runAgent_rejects_when_tools_selected_but_provider_does_not_support', async () => {
    const pluginWithoutTools = makePlugin(); // supportsTools is absent (falsy)
    vi.mocked(agentService.getById).mockReturnValue(
      makeAgent({ toolSelection: ['builtin:foo'] }) as never,
    );
    vi.mocked(getProvider).mockReturnValue(pluginWithoutTools as never);

    await expect(
      runAgent({ agentId: 'a1', threadId: 't1', userText: 'hi' }),
    ).rejects.toThrow(/openai/i);

    expect(diagnosticsService.report).toHaveBeenCalled();
  });

  // 13 ── Happy path: tool_use then continues ────────────────────────────────

  it('runAgent_invokes_tool_then_continues', async () => {
    const echoDescriptor = makeToolDescriptor('builtin:echo');
    const plugin = makeToolPlugin();

    vi.mocked(agentService.getById).mockReturnValue(
      makeAgent({ toolSelection: ['builtin:echo'] }) as never,
    );
    vi.mocked(getProvider).mockReturnValue(plugin as never);
    vi.mocked(commands.agentsToolsList).mockResolvedValue([echoDescriptor] as never);
    vi.mocked(invokeTool).mockResolvedValue({ ok: true } as never);

    let callCount = 0;
    vi.mocked(plugin.parseToolStream).mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return makeAsyncGen([
          { type: 'text', text: 'Let me check' },
          { type: 'tool_use', id: 'tu1', name: 'builtin:echo', input: { x: 1 } },
          { type: 'message_stop' },
        ]);
      }
      return makeAsyncGen([
        { type: 'text', text: 'Done!' },
        { type: 'message_stop' },
      ]);
    });

    await runAgent({ agentId: 'a1', threadId: 't1', userText: 'ask echo' });

    const calls = vi.mocked(agentService.insertMessage).mock.calls;
    // Must have at least 4 persisted messages: user, assistant+toolUse, tool result, assistant
    expect(calls.length).toBeGreaterThanOrEqual(4);

    const userCall = calls[0][0];
    expect(userCall.role).toBe('user');
    expect((userCall.content as { text: string }).text).toBe('ask echo');

    const assistantWithTool = calls[1][0];
    expect(assistantWithTool.role).toBe('assistant');
    expect((assistantWithTool.content as { text: string; toolUse?: unknown[] }).text).toBe('Let me check');
    expect((assistantWithTool.content as { toolUse: Array<{ id: string; name: string; input: unknown }> }).toolUse).toEqual([
      { id: 'tu1', name: 'builtin:echo', input: { x: 1 } },
    ]);

    const toolResultCall = calls[2][0];
    expect(toolResultCall.role).toBe('tool');
    expect(
      (toolResultCall.content as { toolResult: { toolUseId: string; output: unknown } }).toolResult,
    ).toEqual({ toolUseId: 'tu1', output: { ok: true } });

    const finalAssistant = calls[3][0];
    expect(finalAssistant.role).toBe('assistant');
    expect((finalAssistant.content as { text: string }).text).toBe('Done!');
    expect(
      (finalAssistant.content as { toolUse?: unknown[] }).toolUse,
    ).toBeFalsy();

    expect(invokeTool).toHaveBeenCalledWith('builtin:echo', { x: 1 });
    expect(invokeTool).toHaveBeenCalledTimes(1);
  });

  // 14 ── Only selected tools are passed to buildToolRequest ─────────────────

  it('runAgent_passes_only_selected_tools_to_provider', async () => {
    const echoDescriptor = makeToolDescriptor('builtin:echo');
    const otherDescriptor = makeToolDescriptor('builtin:other');
    const extDescriptor = makeToolDescriptor('ext.foo:bar');
    const plugin = makeToolPlugin();

    vi.mocked(agentService.getById).mockReturnValue(
      makeAgent({ toolSelection: ['builtin:echo'] }) as never,
    );
    vi.mocked(getProvider).mockReturnValue(plugin as never);
    vi.mocked(commands.agentsToolsList).mockResolvedValue(
      [echoDescriptor, otherDescriptor, extDescriptor] as never,
    );
    vi.mocked(invokeTool).mockResolvedValue({} as never);
    vi.mocked(plugin.parseToolStream).mockReturnValue(
      makeAsyncGen([{ type: 'text', text: 'ok' }, { type: 'message_stop' }]),
    );

    await runAgent({ agentId: 'a1', threadId: 't1', userText: 'go' });

    expect(plugin.buildToolRequest).toHaveBeenCalled();
    const toolsArg = vi.mocked(plugin.buildToolRequest).mock.calls[0][3] as Array<{ id: string }>;
    expect(toolsArg).toHaveLength(1);
    // Tool id is wire-encoded for the provider (Anthropic rejects ':' in names).
    // The agent loop holds a map that decodes back to the FQID before invokeTool.
    expect(toolsArg[0].id).toBe(encodeToolIdForWire('builtin:echo'));
  });

  // 15 ── Rejects when tool invocation fails (no tool result persisted) ───────

  it('runAgent_rejects_when_tool_invocation_fails', async () => {
    const echoDescriptor = makeToolDescriptor('builtin:echo');
    const plugin = makeToolPlugin();

    vi.mocked(agentService.getById).mockReturnValue(
      makeAgent({ toolSelection: ['builtin:echo'] }) as never,
    );
    vi.mocked(getProvider).mockReturnValue(plugin as never);
    vi.mocked(commands.agentsToolsList).mockResolvedValue([echoDescriptor] as never);
    vi.mocked(invokeTool).mockRejectedValue(new Error('tool failed') as never);

    vi.mocked(plugin.parseToolStream).mockReturnValue(
      makeAsyncGen([
        { type: 'text', text: 'Working...' },
        { type: 'tool_use', id: 'tu2', name: 'builtin:echo', input: {} },
        { type: 'message_stop' },
      ]),
    );

    await expect(
      runAgent({ agentId: 'a1', threadId: 't1', userText: 'run it' }),
    ).rejects.toThrow();

    expect(diagnosticsService.report).toHaveBeenCalled();

    // tool result message must NOT be persisted
    const calls = vi.mocked(agentService.insertMessage).mock.calls;
    const toolResultCall = calls.find((c) => c[0].role === 'tool');
    expect(toolResultCall).toBeUndefined();
  });

  // 16 ── Multiple tool_use blocks in one turn ───────────────────────────────

  it('runAgent_handles_multiple_tool_uses_in_one_turn', async () => {
    const echo1 = makeToolDescriptor('builtin:echo');
    const echo2 = makeToolDescriptor('builtin:greet');
    const plugin = makeToolPlugin();

    vi.mocked(agentService.getById).mockReturnValue(
      makeAgent({ toolSelection: ['builtin:echo', 'builtin:greet'] }) as never,
    );
    vi.mocked(getProvider).mockReturnValue(plugin as never);
    vi.mocked(commands.agentsToolsList).mockResolvedValue([echo1, echo2] as never);
    vi.mocked(invokeTool)
      .mockResolvedValueOnce({ result: 'echo-out' } as never)
      .mockResolvedValueOnce({ result: 'greet-out' } as never);

    let callCount = 0;
    vi.mocked(plugin.parseToolStream).mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return makeAsyncGen([
          { type: 'tool_use', id: 'tu-a', name: 'builtin:echo', input: { v: 1 } },
          { type: 'tool_use', id: 'tu-b', name: 'builtin:greet', input: { v: 2 } },
          { type: 'message_stop' },
        ]);
      }
      return makeAsyncGen([{ type: 'text', text: 'Both done' }, { type: 'message_stop' }]);
    });

    await runAgent({ agentId: 'a1', threadId: 't1', userText: 'run both' });

    expect(invokeTool).toHaveBeenCalledTimes(2);
    // Sequential order
    expect(vi.mocked(invokeTool).mock.calls[0][0]).toBe('builtin:echo');
    expect(vi.mocked(invokeTool).mock.calls[1][0]).toBe('builtin:greet');

    const calls = vi.mocked(agentService.insertMessage).mock.calls;
    const toolCalls = calls.filter((c) => c[0].role === 'tool');
    expect(toolCalls).toHaveLength(2);
    expect(
      (toolCalls[0][0].content as { toolResult: { toolUseId: string } }).toolResult.toolUseId,
    ).toBe('tu-a');
    expect(
      (toolCalls[1][0].content as { toolResult: { toolUseId: string } }).toolResult.toolUseId,
    ).toBe('tu-b');
  });

  // 17 ── Loop guard: rejects after max 20 turns ─────────────────────────────

  it('runAgent_loops_at_most_N_turns', async () => {
    const echoDescriptor = makeToolDescriptor('builtin:echo');
    const plugin = makeToolPlugin();

    vi.mocked(agentService.getById).mockReturnValue(
      makeAgent({ toolSelection: ['builtin:echo'] }) as never,
    );
    vi.mocked(getProvider).mockReturnValue(plugin as never);
    vi.mocked(commands.agentsToolsList).mockResolvedValue([echoDescriptor] as never);
    // Tool always succeeds
    vi.mocked(invokeTool).mockResolvedValue({ ok: true } as never);
    // Plugin always yields a tool_use block — never stops
    vi.mocked(plugin.parseToolStream).mockImplementation(() =>
      makeAsyncGen([
        { type: 'tool_use', id: 'tu-loop', name: 'builtin:echo', input: {} },
        { type: 'message_stop' },
      ]),
    );

    await expect(
      runAgent({ agentId: 'a1', threadId: 't1', userText: 'loop' }),
    ).rejects.toThrow();

    // Should have invoked at most 20 times (one per turn)
    expect(vi.mocked(invokeTool).mock.calls.length).toBeLessThanOrEqual(20);
    // Must not run indefinitely — guard must kick in
    expect(vi.mocked(invokeTool).mock.calls.length).toBeGreaterThan(0);
    expect(diagnosticsService.report).toHaveBeenCalled();
  });

  // 18 ── Prior tool messages included in history passed to provider ──────────

  it('runAgent_includes_prior_tool_messages_in_history', async () => {
    const echoDescriptor = makeToolDescriptor('builtin:echo');
    const plugin = makeToolPlugin();

    const priorUser = makeMessage({ id: 'h1', role: 'user', content: { text: 'prior q' }, createdAt: 1000 });
    const priorAssistantWithTool = makeMessage({
      id: 'h2',
      role: 'assistant',
      content: { text: '', toolUse: [{ id: 'tu0', name: 'builtin:echo', input: {} }] },
      createdAt: 2000,
    });
    const priorToolResult = makeMessage({
      id: 'h3',
      role: 'tool',
      content: { toolResult: { toolUseId: 'tu0', output: 42 } },
      createdAt: 3000,
    });
    const newUser = makeMessage({ id: 'h4', role: 'user', content: { text: 'new q' }, createdAt: 4000 });

    vi.mocked(agentService.getById).mockReturnValue(
      makeAgent({ toolSelection: ['builtin:echo'] }) as never,
    );
    vi.mocked(getProvider).mockReturnValue(plugin as never);
    vi.mocked(commands.agentsToolsList).mockResolvedValue([echoDescriptor] as never);
    // Return all 4 messages (prior 3 + newly inserted user)
    vi.mocked(agentService.listMessages).mockResolvedValue(
      [priorUser, priorAssistantWithTool, priorToolResult, newUser] as never,
    );
    vi.mocked(plugin.parseToolStream).mockReturnValue(
      makeAsyncGen([{ type: 'text', text: 'reply' }, { type: 'message_stop' }]),
    );

    await runAgent({ agentId: 'a1', threadId: 't1', userText: 'new q' });

    expect(plugin.buildToolRequest).toHaveBeenCalled();
    const messagesArg = vi.mocked(plugin.buildToolRequest).mock.calls[0][0] as Array<{
      role: string;
      toolUseId?: string;
    }>;

    // Must include the tool message with toolUseId from prior history
    const toolMsg = messagesArg.find((m) => m.role === 'tool');
    expect(toolMsg).toBeDefined();
    expect(toolMsg!.toolUseId).toBe('tu0');

    // Full history in order: (optional system), prior user, prior assistant, prior tool, new user
    const roles = messagesArg.map((m) => m.role);
    const userIdx = roles.indexOf('user');
    const assistantIdx = roles.indexOf('assistant');
    const toolIdx = roles.indexOf('tool');
    expect(userIdx).toBeLessThan(assistantIdx);
    expect(assistantIdx).toBeLessThan(toolIdx);
  });

  // 19 ── Tool-aware plugin still works for tool-less agent ──────────────────

  it('runAgent_does_not_reject_when_no_tools_selected_even_if_supportsTools_true', async () => {
    const plugin = makeToolPlugin();
    vi.mocked(agentService.getById).mockReturnValue(makeAgent({ toolSelection: [] }) as never);
    vi.mocked(getProvider).mockReturnValue(plugin as never);
    mockStreamChatTokens(['result text']);

    await runAgent({ agentId: 'a1', threadId: 't1', userText: 'hi' });

    // Must succeed via text-only path
    expect(streamChat).toHaveBeenCalled();
    expect(plugin.parseToolStream).not.toHaveBeenCalled();
  });

  // 20 ── Assistant message persisted BEFORE invokeTool is called ────────────

  it('runAgent_persists_assistant_message_before_invoking_tools', async () => {
    const echoDescriptor = makeToolDescriptor('builtin:echo');
    const plugin = makeToolPlugin();
    const callOrder: string[] = [];

    vi.mocked(agentService.getById).mockReturnValue(
      makeAgent({ toolSelection: ['builtin:echo'] }) as never,
    );
    vi.mocked(getProvider).mockReturnValue(plugin as never);
    vi.mocked(commands.agentsToolsList).mockResolvedValue([echoDescriptor] as never);

    vi.mocked(agentService.insertMessage).mockImplementation(async (input) => {
      callOrder.push(`insert:${input.role}`);
      return makeMessage({ role: input.role as 'user' | 'assistant' }) as never;
    });

    vi.mocked(invokeTool).mockImplementation(async () => {
      callOrder.push('invokeTool');
      return { ok: true };
    });

    let callCount = 0;
    vi.mocked(plugin.parseToolStream).mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return makeAsyncGen([
          { type: 'text', text: 'Let me check' },
          { type: 'tool_use', id: 'tu1', name: 'builtin:echo', input: { x: 1 } },
          { type: 'message_stop' },
        ]);
      }
      return makeAsyncGen([{ type: 'text', text: 'Done' }, { type: 'message_stop' }]);
    });

    await runAgent({ agentId: 'a1', threadId: 't1', userText: 'check' });

    // Find the positions of the assistant insert and the first invokeTool call
    const assistantInsertIdx = callOrder.indexOf('insert:assistant');
    const invokeToolIdx = callOrder.indexOf('invokeTool');

    expect(assistantInsertIdx).toBeGreaterThanOrEqual(0);
    expect(invokeToolIdx).toBeGreaterThan(assistantInsertIdx);
  });

  // ── Item 10: Run integration + cooperative cancel ───────────────────────────

  // 21 ── runAgent starts a run with kind:'agent' ───────────────────────────

  it('runAgent_starts_a_run_with_kind_agent', async () => {
    await runAgent({ agentId: 'a1', threadId: 't1', userText: 'hello there' });

    expect(runService.startLocal).toHaveBeenCalledOnce();
    const callArg = vi.mocked(runService.startLocal).mock.calls[0][0];
    expect(callArg.kind).toBe('agent');
    expect(callArg.cancellable).toBe(true);
    expect(callArg.extensionId).toBe('agents');
    // label must contain the agent name and a slice of userText
    expect(callArg.label).toContain('Test Agent');
    expect(callArg.label).toContain('hello there');
  });

  // 22 ── handle.done called once on text-only success; fail never called ────

  it('runAgent_calls_handle_done_on_text_only_success', async () => {
    mockStreamChatTokens(['Hello', ' world']);

    await runAgent({ agentId: 'a1', threadId: 't1', userText: 'hi' });

    expect(fakeHandle.done).toHaveBeenCalledOnce();
    expect(fakeHandle.fail).not.toHaveBeenCalled();
  });

  // 23 ── handle.done called once on full tool-loop success ─────────────────

  it('runAgent_calls_handle_done_on_tool_loop_success', async () => {
    const echoDescriptor = makeToolDescriptor('builtin:echo');
    const plugin = makeToolPlugin();

    vi.mocked(agentService.getById).mockReturnValue(
      makeAgent({ toolSelection: ['builtin:echo'] }) as never,
    );
    vi.mocked(getProvider).mockReturnValue(plugin as never);
    vi.mocked(commands.agentsToolsList).mockResolvedValue([echoDescriptor] as never);
    vi.mocked(invokeTool).mockResolvedValue({ ok: true } as never);

    let callCount = 0;
    vi.mocked(plugin.parseToolStream).mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return makeAsyncGen([
          { type: 'text', text: 'thinking' },
          { type: 'tool_use', id: 'tu1', name: 'builtin:echo', input: {} },
          { type: 'message_stop' },
        ]);
      }
      return makeAsyncGen([{ type: 'text', text: 'Done!' }, { type: 'message_stop' }]);
    });

    await runAgent({ agentId: 'a1', threadId: 't1', userText: 'go' });

    expect(fakeHandle.done).toHaveBeenCalledOnce();
    expect(fakeHandle.fail).not.toHaveBeenCalled();
  });

  // 24 ── handle.fail called with the error when provider stream errors ──────

  it('runAgent_calls_handle_fail_on_provider_error', async () => {
    mockStreamChatError([], 'stream exploded');

    await expect(runAgent({ agentId: 'a1', threadId: 't1', userText: 'hi' })).rejects.toThrow();

    expect(fakeHandle.fail).toHaveBeenCalledOnce();
    // fail receives a string (per LocalRunHandle.fail(error: string))
    const failArg = vi.mocked(fakeHandle.fail).mock.calls[0][0];
    expect(typeof failArg).toBe('string');
    expect(fakeHandle.done).not.toHaveBeenCalled();
  });

  // 25 ── handle.fail called when invokeTool rejects ────────────────────────

  it('runAgent_calls_handle_fail_on_tool_invocation_error', async () => {
    const echoDescriptor = makeToolDescriptor('builtin:echo');
    const plugin = makeToolPlugin();

    vi.mocked(agentService.getById).mockReturnValue(
      makeAgent({ toolSelection: ['builtin:echo'] }) as never,
    );
    vi.mocked(getProvider).mockReturnValue(plugin as never);
    vi.mocked(commands.agentsToolsList).mockResolvedValue([echoDescriptor] as never);
    vi.mocked(invokeTool).mockRejectedValue(new Error('tool exploded') as never);

    vi.mocked(plugin.parseToolStream).mockReturnValue(
      makeAsyncGen([
        { type: 'tool_use', id: 'tu1', name: 'builtin:echo', input: {} },
        { type: 'message_stop' },
      ]),
    );

    await expect(runAgent({ agentId: 'a1', threadId: 't1', userText: 'go' })).rejects.toThrow();

    expect(fakeHandle.fail).toHaveBeenCalledOnce();
    expect(fakeHandle.done).not.toHaveBeenCalled();
  });

  // 26 ── ALL insertMessage calls carry runId from the handle ────────────────

  it('runAgent_persists_runId_on_messages', async () => {
    const echoDescriptor = makeToolDescriptor('builtin:echo');
    const plugin = makeToolPlugin();

    vi.mocked(agentService.getById).mockReturnValue(
      makeAgent({ toolSelection: ['builtin:echo'] }) as never,
    );
    vi.mocked(getProvider).mockReturnValue(plugin as never);
    vi.mocked(commands.agentsToolsList).mockResolvedValue([echoDescriptor] as never);
    vi.mocked(invokeTool).mockResolvedValue({ ok: true } as never);

    let callCount = 0;
    vi.mocked(plugin.parseToolStream).mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return makeAsyncGen([
          { type: 'text', text: 'thinking' },
          { type: 'tool_use', id: 'tu1', name: 'builtin:echo', input: {} },
          { type: 'message_stop' },
        ]);
      }
      return makeAsyncGen([{ type: 'text', text: 'done' }, { type: 'message_stop' }]);
    });

    await runAgent({ agentId: 'a1', threadId: 't1', userText: 'ask' });

    const calls = vi.mocked(agentService.insertMessage).mock.calls;
    // All 4 messages (user, assistant+tool, tool result, assistant) must carry runId
    expect(calls.length).toBeGreaterThanOrEqual(4);
    for (const [callArg] of calls) {
      expect(callArg.runId).toBe('run-fake-1');
    }
  });

  // 27 ── onCancel is subscribed once per runAgent call ─────────────────────

  it('runAgent_subscribes_to_handle_onCancel', async () => {
    await runAgent({ agentId: 'a1', threadId: 't1', userText: 'hi' });

    expect(fakeHandle.onCancel).toHaveBeenCalledOnce();
  });

  // 28 ── loop exits cleanly after cancel fires between turns ───────────────

  it('runAgent_aborts_loop_on_cancel_between_turns', async () => {
    const echoDescriptor = makeToolDescriptor('builtin:echo');
    const plugin = makeToolPlugin();

    vi.mocked(agentService.getById).mockReturnValue(
      makeAgent({ toolSelection: ['builtin:echo'] }) as never,
    );
    vi.mocked(getProvider).mockReturnValue(plugin as never);
    vi.mocked(commands.agentsToolsList).mockResolvedValue([echoDescriptor] as never);

    // Tool resolves normally — cancel fires AFTER assistant persisted, BEFORE next LLM turn
    vi.mocked(invokeTool).mockImplementation(async () => {
      // Fire cancel mid-tool execution (simulates cancel arriving while tool runs)
      // The tool should still complete; cancel is checked between turns
      return { ok: true };
    });

    let buildCallCount = 0;
    vi.mocked(plugin.parseToolStream).mockImplementation(() => {
      buildCallCount++;
      return makeAsyncGen([
        { type: 'tool_use', id: `tu${buildCallCount}`, name: 'builtin:echo', input: {} },
        { type: 'message_stop' },
      ]);
    });

    // Intercept insertMessage so we can fire cancel after first assistant is persisted
    let assistantInsertCount = 0;
    vi.mocked(agentService.insertMessage).mockImplementation(async (input) => {
      if (input.role === 'assistant') {
        assistantInsertCount++;
        if (assistantInsertCount === 1) {
          // Fire cancel right after the first assistant message is inserted
          fakeHandle._cancelCallbacks[0]?.();
        }
      }
      return makeMessage({ role: input.role as 'user' | 'assistant' }) as never;
    });

    // Should resolve cleanly (not reject)
    await expect(runAgent({ agentId: 'a1', threadId: 't1', userText: 'go' })).resolves.toBeUndefined();

    // Only one LLM turn should have happened (buildToolRequest called once)
    expect(plugin.buildToolRequest).toHaveBeenCalledTimes(1);
    // Cancellation must NOT call fail
    expect(fakeHandle.fail).not.toHaveBeenCalled();
  });

  // 29 ── cancel before tool resolves: tool still awaited, then loop exits ──

  it('runAgent_does_not_check_abort_mid_tool', async () => {
    const echoDescriptor = makeToolDescriptor('builtin:echo');
    const plugin = makeToolPlugin();

    vi.mocked(agentService.getById).mockReturnValue(
      makeAgent({ toolSelection: ['builtin:echo'] }) as never,
    );
    vi.mocked(getProvider).mockReturnValue(plugin as never);
    vi.mocked(commands.agentsToolsList).mockResolvedValue([echoDescriptor] as never);

    let toolResolve: (v: unknown) => void;
    const toolPromise = new Promise((resolve) => { toolResolve = resolve; });

    vi.mocked(invokeTool).mockImplementation(() => {
      // Fire cancel BEFORE the tool resolves
      fakeHandle._cancelCallbacks[0]?.();
      // Then resolve the tool
      toolResolve({ ok: true });
      return toolPromise;
    });

    vi.mocked(plugin.parseToolStream).mockReturnValue(
      makeAsyncGen([
        { type: 'tool_use', id: 'tu1', name: 'builtin:echo', input: {} },
        { type: 'message_stop' },
      ]),
    );

    await expect(runAgent({ agentId: 'a1', threadId: 't1', userText: 'go' })).resolves.toBeUndefined();

    // Tool result must still be persisted (tool was awaited fully)
    const calls = vi.mocked(agentService.insertMessage).mock.calls;
    const toolResultCall = calls.find((c) => c[0].role === 'tool');
    expect(toolResultCall).toBeDefined();

    // Only one LLM turn (no second turn after cancel)
    expect(plugin.buildToolRequest).toHaveBeenCalledTimes(1);

    // No fail
    expect(fakeHandle.fail).not.toHaveBeenCalled();
  });

  // 30 ── after cancel: neither done() nor fail() is called ─────────────────

  it('runAgent_does_not_call_done_or_fail_after_cancel', async () => {
    const echoDescriptor = makeToolDescriptor('builtin:echo');
    const plugin = makeToolPlugin();

    vi.mocked(agentService.getById).mockReturnValue(
      makeAgent({ toolSelection: ['builtin:echo'] }) as never,
    );
    vi.mocked(getProvider).mockReturnValue(plugin as never);
    vi.mocked(commands.agentsToolsList).mockResolvedValue([echoDescriptor] as never);
    vi.mocked(invokeTool).mockResolvedValue({ ok: true } as never);

    vi.mocked(plugin.parseToolStream).mockReturnValue(
      makeAsyncGen([
        { type: 'tool_use', id: 'tu1', name: 'builtin:echo', input: {} },
        { type: 'message_stop' },
      ]),
    );

    // Fire cancel after the first assistant message persists
    let assistantInsertCount = 0;
    vi.mocked(agentService.insertMessage).mockImplementation(async (input) => {
      if (input.role === 'assistant') {
        assistantInsertCount++;
        if (assistantInsertCount === 1) {
          fakeHandle._cancelCallbacks[0]?.();
        }
      }
      return makeMessage({ role: input.role as 'user' | 'assistant' }) as never;
    });

    await runAgent({ agentId: 'a1', threadId: 't1', userText: 'go' });

    // After cancel: neither done nor fail
    expect(fakeHandle.done).not.toHaveBeenCalled();
    expect(fakeHandle.fail).not.toHaveBeenCalled();
  });

  // ── Item 15: abortSignal as second cancel path ─────────────────────────────

  // 31 ── loop exits when abortSignal fires between turns ───────────────────

  it('runAgent_aborts_loop_when_abortSignal_fires', async () => {
    const echoDescriptor = makeToolDescriptor('builtin:echo');
    const plugin = makeToolPlugin();
    const controller = new AbortController();

    vi.mocked(agentService.getById).mockReturnValue(
      makeAgent({ toolSelection: ['builtin:echo'] }) as never,
    );
    vi.mocked(getProvider).mockReturnValue(plugin as never);
    vi.mocked(commands.agentsToolsList).mockResolvedValue([echoDescriptor] as never);
    vi.mocked(invokeTool).mockResolvedValue({ ok: true } as never);

    let buildCallCount = 0;
    vi.mocked(plugin.parseToolStream).mockImplementation(() => {
      buildCallCount++;
      return makeAsyncGen([
        { type: 'tool_use', id: `tu${buildCallCount}`, name: 'builtin:echo', input: {} },
        { type: 'message_stop' },
      ]);
    });

    // Fire abort via AbortController after first assistant message is persisted
    let assistantInsertCount = 0;
    vi.mocked(agentService.insertMessage).mockImplementation(async (input) => {
      if (input.role === 'assistant') {
        assistantInsertCount++;
        if (assistantInsertCount === 1) {
          controller.abort();
        }
      }
      return makeMessage({ role: input.role as 'user' | 'assistant' }) as never;
    });

    await expect(
      runAgent({ agentId: 'a1', threadId: 't1', userText: 'go', abortSignal: controller.signal }),
    ).resolves.toBeUndefined();

    // Only one LLM turn (second turn was blocked by abortSignal)
    expect(plugin.buildToolRequest).toHaveBeenCalledTimes(1);
    expect(fakeHandle.fail).not.toHaveBeenCalled();
  });

  // 32 ── returns immediately (no run created) when abortSignal already aborted

  it('runAgent_returns_immediately_when_abortSignal_already_aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      runAgent({ agentId: 'a1', threadId: 't1', userText: 'hi', abortSignal: controller.signal }),
    ).resolves.toBeUndefined();

    expect(runService.startLocal).not.toHaveBeenCalled();
    expect(agentService.insertMessage).not.toHaveBeenCalled();
    expect(diagnosticsService.report).not.toHaveBeenCalled();
  });

  // 33 ── abort mid-loop: done() and fail() are NOT called ──────────────────

  it('runAgent_does_not_call_done_when_abortSignal_aborts_mid_loop', async () => {
    const echoDescriptor = makeToolDescriptor('builtin:echo');
    const plugin = makeToolPlugin();
    const controller = new AbortController();

    vi.mocked(agentService.getById).mockReturnValue(
      makeAgent({ toolSelection: ['builtin:echo'] }) as never,
    );
    vi.mocked(getProvider).mockReturnValue(plugin as never);
    vi.mocked(commands.agentsToolsList).mockResolvedValue([echoDescriptor] as never);
    vi.mocked(invokeTool).mockResolvedValue({ ok: true } as never);

    vi.mocked(plugin.parseToolStream).mockReturnValue(
      makeAsyncGen([
        { type: 'tool_use', id: 'tu1', name: 'builtin:echo', input: {} },
        { type: 'message_stop' },
      ]),
    );

    // Abort via signal after first assistant insert
    let assistantInsertCount = 0;
    vi.mocked(agentService.insertMessage).mockImplementation(async (input) => {
      if (input.role === 'assistant') {
        assistantInsertCount++;
        if (assistantInsertCount === 1) {
          controller.abort();
        }
      }
      return makeMessage({ role: input.role as 'user' | 'assistant' }) as never;
    });

    await runAgent({ agentId: 'a1', threadId: 't1', userText: 'go', abortSignal: controller.signal });

    expect(fakeHandle.done).not.toHaveBeenCalled();
    expect(fakeHandle.fail).not.toHaveBeenCalled();
  });

  // 34 ── happy path with abortSignal that never fires ──────────────────────

  it('runAgent_continues_normally_when_abortSignal_never_fires', async () => {
    const controller = new AbortController();
    mockStreamChatTokens(['Hello', ' world']);

    await runAgent({ agentId: 'a1', threadId: 't1', userText: 'hi', abortSignal: controller.signal });

    expect(fakeHandle.done).toHaveBeenCalledOnce();
    expect(fakeHandle.fail).not.toHaveBeenCalled();

    const calls = vi.mocked(agentService.insertMessage).mock.calls;
    const assistantCall = calls.find((c) => c[0].role === 'assistant');
    expect(assistantCall).toBeDefined();
    expect((assistantCall![0].content as { text: string }).text).toBe('Hello world');
  });
});

// ── encodeToolIdForWire — wire-name encoder for provider tool-name regexes ────

describe('encodeToolIdForWire', () => {
  it('encodes the colon in builtin FQIDs', () => {
    expect(encodeToolIdForWire('builtin:calculator')).toBe('builtin__calculator');
  });

  it('encodes both dots and colons in Tier 2 FQIDs', () => {
    expect(encodeToolIdForWire('ext.foo:bar')).toBe('ext--foo__bar');
  });

  it('produces only chars allowed by Anthropic tool-name regex', () => {
    const allowed = /^[a-zA-Z0-9_-]+$/;
    expect(encodeToolIdForWire('builtin:calculator')).toMatch(allowed);
    expect(encodeToolIdForWire('ext.foo:bar')).toMatch(allowed);
    expect(encodeToolIdForWire('ext.scope.deep:tool-name')).toMatch(allowed);
  });

  it('is a no-op for ids that are already wire-safe', () => {
    expect(encodeToolIdForWire('plain_id')).toBe('plain_id');
    expect(encodeToolIdForWire('with-hyphen')).toBe('with-hyphen');
  });
});

// ── coalesceConsecutiveSameRole — guards strict role-alternation rule ─────────

describe('coalesceConsecutiveSameRole', () => {
  it('merges consecutive user messages with blank-line separator', () => {
    const out = coalesceConsecutiveSameRole([
      { role: 'user', content: 'first' },
      { role: 'user', content: 'second' },
      { role: 'user', content: 'third' },
    ]);
    expect(out).toEqual([
      { role: 'user', content: 'first\n\nsecond\n\nthird' },
    ]);
  });

  it('preserves alternating user/assistant pairs unchanged', () => {
    const input = [
      { role: 'user' as const, content: 'q' },
      { role: 'assistant' as const, content: 'a' },
      { role: 'user' as const, content: 'q2' },
    ];
    expect(coalesceConsecutiveSameRole(input)).toEqual(input);
  });

  it('keeps system message at the front intact', () => {
    const out = coalesceConsecutiveSameRole([
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'a' },
      { role: 'user', content: 'b' },
    ]);
    expect(out).toEqual([
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'a\n\nb' },
    ]);
  });

  it('passes tool messages through without merging', () => {
    const input = [
      { role: 'assistant' as const, content: '', toolUse: [{ id: 't', name: 'x', input: {} }] },
      { role: 'tool' as const, content: '{}', toolUseId: 't' },
      { role: 'tool' as const, content: '{}', toolUseId: 't2' },
    ];
    expect(coalesceConsecutiveSameRole(input)).toEqual(input);
  });

  it('does not merge assistant messages with toolUse blocks', () => {
    const input = [
      { role: 'assistant' as const, content: 'thinking', toolUse: [{ id: 't1', name: 'x', input: {} }] },
      { role: 'assistant' as const, content: 'still thinking' },
    ];
    // Don't collapse — toolUse on the first one means it must stand alone.
    expect(coalesceConsecutiveSameRole(input)).toEqual(input);
  });
});
