import { describe, it, expect, vi } from 'vitest';

import {
  ensureThread,
  handleSendMessage,
  handleNewThread,
  extractTextFromMessage,
  extractToolUsesFromMessage,
  messageBubbleVariant,
  handleCancelSend,
  deriveThreadTitle,
  resolveThreadId,
} from './agentChatView.helpers';

import type { ThreadDef, MessageDef } from './types';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const makeThread = (over: Partial<ThreadDef> = {}): ThreadDef => ({
  id: 'thread-1',
  agentId: 'agent-1',
  title: null,
  createdAt: 1000,
  updatedAt: 2000,
  ...over,
});

const makeMessage = (over: Partial<MessageDef> = {}): MessageDef => ({
  id: 'msg-1',
  threadId: 'thread-1',
  role: 'user',
  content: { text: 'Hello' },
  createdAt: 1000,
  runId: null,
  ...over,
});

// ── ensureThread ──────────────────────────────────────────────────────────────

describe('ensureThread', () => {
  it('always creates a new thread, even when threads exist', async () => {
    const oldThread = makeThread({ id: 'old', agentId: 'a', updatedAt: 1 });
    const newThread = makeThread({ id: 'new', agentId: 'a', updatedAt: 2 });
    const service = {
      createThread: vi.fn().mockResolvedValue(newThread),
    };

    const result = await ensureThread('a', { service });

    expect(result.id).toBe('new');
    expect(service.createThread).toHaveBeenCalledWith('a', '');
    void oldThread; // fixture retained for readability — old thread must not be returned
  });

  it('always creates a new thread when no threads exist', async () => {
    const newThread = makeThread({ id: 'thread-new' });
    const service = {
      createThread: vi.fn().mockResolvedValue(newThread),
    };

    const result = await ensureThread('agent-1', { service });

    expect(service.createThread).toHaveBeenCalledWith('agent-1', '');
    expect(result).toBe(newThread);
  });

  it('does not call listThreads', async () => {
    const newThread = makeThread({ id: 'new', agentId: 'a', updatedAt: 1 });
    const service = {
      listThreads: vi.fn().mockResolvedValue([makeThread({ id: 'old' })]),
      createThread: vi.fn().mockResolvedValue(newThread),
    };

    await ensureThread('a', { service } as Parameters<typeof ensureThread>[1]);

    expect(service.listThreads).not.toHaveBeenCalled();
  });
});

// ── handleSendMessage ─────────────────────────────────────────────────────────

describe('handleSendMessage', () => {
  it('handleSendMessage_invokes_runAgent_with_inputs_and_abortSignal', async () => {
    const runAgent = vi.fn().mockResolvedValue(undefined);
    const refreshMessages = vi.fn().mockResolvedValue(undefined);
    const controller = new AbortController();

    await handleSendMessage(
      { agentId: 'agent-1', threadId: 'thread-1', userText: 'Hello' },
      { runAgent, refreshMessages, currentAbortController: controller },
    );

    expect(runAgent).toHaveBeenCalledWith({
      agentId: 'agent-1',
      threadId: 'thread-1',
      userText: 'Hello',
      abortSignal: controller.signal,
    });
  });

  it('handleSendMessage_calls_refreshMessages_on_success', async () => {
    const runAgent = vi.fn().mockResolvedValue(undefined);
    const refreshMessages = vi.fn().mockResolvedValue(undefined);
    const controller = new AbortController();

    await handleSendMessage(
      { agentId: 'agent-1', threadId: 'thread-1', userText: 'Hello' },
      { runAgent, refreshMessages, currentAbortController: controller },
    );

    expect(refreshMessages).toHaveBeenCalledTimes(1);
  });

  it('handleSendMessage_calls_refreshMessages_even_on_error', async () => {
    const runAgent = vi.fn().mockRejectedValue(new Error('api failure'));
    const refreshMessages = vi.fn().mockResolvedValue(undefined);
    const controller = new AbortController();

    await expect(
      handleSendMessage(
        { agentId: 'agent-1', threadId: 'thread-1', userText: 'Hello' },
        { runAgent, refreshMessages, currentAbortController: controller },
      ),
    ).rejects.toThrow('api failure');

    expect(refreshMessages).toHaveBeenCalledTimes(1);
  });
});

// ── handleNewThread ───────────────────────────────────────────────────────────

describe('handleNewThread', () => {
  it('handleNewThread_creates_thread_and_calls_refreshThreadsAndSelect', async () => {
    const newThread = makeThread({ id: 'thread-new' });
    const service = {
      listThreads: vi.fn(),
      createThread: vi.fn().mockResolvedValue(newThread),
    };
    const refreshThreadsAndSelect = vi.fn().mockResolvedValue(undefined);

    const result = await handleNewThread('agent-1', { service, refreshThreadsAndSelect });

    expect(service.createThread).toHaveBeenCalledWith('agent-1', expect.anything());
    expect(refreshThreadsAndSelect).toHaveBeenCalledWith(newThread);
    expect(result).toBe(newThread);
  });
});

// ── extractTextFromMessage ────────────────────────────────────────────────────

describe('extractTextFromMessage', () => {
  it('extractTextFromMessage_user', () => {
    const msg = makeMessage({ role: 'user', content: { text: 'What is the weather?' } });
    expect(extractTextFromMessage(msg)).toBe('What is the weather?');
  });

  it('extractTextFromMessage_assistant', () => {
    const msg = makeMessage({
      role: 'assistant',
      content: { text: 'The weather is sunny.' },
    });
    expect(extractTextFromMessage(msg)).toBe('The weather is sunny.');
  });

  it('extractTextFromMessage_assistant_with_toolUse_only', () => {
    const msg = makeMessage({
      role: 'assistant',
      content: {
        text: '',
        toolUse: [{ id: 'tu1', name: 'search', input: { query: 'weather' } }],
      },
    });
    expect(extractTextFromMessage(msg)).toBe('');
  });

  it('extractTextFromMessage_tool', () => {
    const output = { ok: true };
    const msg = makeMessage({
      role: 'tool',
      content: { toolResult: { toolUseId: 'tu1', output } },
    });
    expect(extractTextFromMessage(msg)).toBe(JSON.stringify(output));
  });
});

// ── extractToolUsesFromMessage ────────────────────────────────────────────────

describe('extractToolUsesFromMessage', () => {
  it('extractToolUsesFromMessage_user_returns_empty', () => {
    const msg = makeMessage({ role: 'user', content: { text: 'Hello' } });
    expect(extractToolUsesFromMessage(msg)).toEqual([]);
  });

  it('extractToolUsesFromMessage_assistant_with_no_toolUse_returns_empty', () => {
    const msg = makeMessage({
      role: 'assistant',
      content: { text: 'Here is your answer.' },
    });
    expect(extractToolUsesFromMessage(msg)).toEqual([]);
  });

  it('extractToolUsesFromMessage_assistant_with_toolUse_returns_array', () => {
    const toolUses = [
      { id: 'tu1', name: 'search', input: { query: 'weather' } },
      { id: 'tu2', name: 'calculator', input: { expr: '1+1' } },
    ];
    const msg = makeMessage({
      role: 'assistant',
      content: { text: '', toolUse: toolUses },
    });
    expect(extractToolUsesFromMessage(msg)).toEqual(toolUses);
  });
});

// ── messageBubbleVariant ──────────────────────────────────────────────────────

describe('messageBubbleVariant', () => {
  it('messageBubbleVariant_returns_role', () => {
    expect(messageBubbleVariant(makeMessage({ role: 'user' }))).toBe('user');
    expect(messageBubbleVariant(makeMessage({ role: 'assistant' }))).toBe('assistant');
    expect(
      messageBubbleVariant(
        makeMessage({
          role: 'tool',
          content: { toolResult: { toolUseId: 'tu1', output: {} } },
        }),
      ),
    ).toBe('tool');
  });
});

// ── handleCancelSend ──────────────────────────────────────────────────────────

describe('handleCancelSend', () => {
  it('handleCancelSend_aborts_when_controller_present', () => {
    const controller = new AbortController();
    handleCancelSend({ abortController: controller });
    expect(controller.signal.aborted).toBe(true);
  });

  it('handleCancelSend_noop_when_controller_null', () => {
    expect(() => handleCancelSend({ abortController: null })).not.toThrow();
  });
});

// ── deriveThreadTitle ─────────────────────────────────────────────────────────

describe('deriveThreadTitle', () => {
  it('returns short message verbatim', () => {
    expect(deriveThreadTitle('Hello world')).toBe('Hello world');
  });

  it('returns "New thread" for empty input', () => {
    expect(deriveThreadTitle('')).toBe('New thread');
    expect(deriveThreadTitle('   ')).toBe('New thread');
  });

  it('truncates long messages at word boundary with ellipsis', () => {
    const long = 'This is a long message that should be truncated at a word boundary near forty';
    const result = deriveThreadTitle(long);
    expect(result.length).toBeLessThanOrEqual(45);
    expect(result.endsWith('…')).toBe(true);
    expect(result).not.toContain('truncated…');
  });

  it('hard-cuts at limit when no late word boundary exists', () => {
    const long = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa bbbbb';
    const result = deriveThreadTitle(long);
    expect(result.endsWith('…')).toBe(true);
  });

  it('collapses internal whitespace', () => {
    expect(deriveThreadTitle('hello\n\n  world')).toBe('hello world');
  });
});

// ── resolveThreadId ───────────────────────────────────────────────────────────
//
// Encodes the contract for what AgentChatView's $effect should do when threads
// are loaded. The entry point (Tab → openAgentForTab) already set currentThreadId
// to its desired value before the view mounts. resolveThreadId must NOT override
// that intent; it only clears a stale id or leaves null alone.

describe('resolveThreadId', () => {
  const t1: ThreadDef = { id: 't1', agentId: 'agent-a', title: null, createdAt: 1000, updatedAt: 2000 };
  const t2: ThreadDef = { id: 't2', agentId: 'agent-a', title: null, createdAt: 500, updatedAt: 1500 };

  it('new-thread path: currentThreadId null with existing threads → stays null', () => {
    // Tab was opened with continueLastThread=false; threadOpener set null.
    // The view must NOT auto-pick threads[0].
    expect(resolveThreadId(null, [t1, t2])).toBeNull();
  });

  it('continue-last path: currentThreadId already set and present → unchanged', () => {
    // Tab was opened with continueLastThread=true; threadOpener already picked t1.
    // The view must leave it alone.
    expect(resolveThreadId('t1', [t1, t2])).toBe('t1');
  });

  it('stale-thread guard: currentThreadId not in loaded threads → null', () => {
    // The thread was deleted between sessions. View should clear the id
    // rather than auto-picking threads[0] (which would silently hide the gap).
    expect(resolveThreadId('t-deleted', [t1, t2])).toBeNull();
  });

  it('empty-threads case: currentThreadId null, no threads → null', () => {
    // Agent has no threads yet; nothing to pick.
    expect(resolveThreadId(null, [])).toBeNull();
  });
});
