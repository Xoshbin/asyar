/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the Tauri core invoke and the extensionIframeSelector before importing
// the module under test so all code paths can be controlled.
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('../../services/extension/extensionIframeSelector', () => ({
  pickExtensionIframe: vi.fn(),
}));

// Mock getExtensionFrameOrigin so postMessage target origin is deterministic.
vi.mock('../../lib/ipc/extensionOrigin', () => ({
  getExtensionFrameOrigin: vi.fn().mockReturnValue('*'),
}));

import { invokeTool } from './toolDispatch';
import { invoke } from '@tauri-apps/api/core';
import { pickExtensionIframe } from '../../services/extension/extensionIframeSelector';

// ── 13. invokeTool routes builtin:<id> to agents_invoke_builtin_tool ─────────

describe('invokeTool builtin routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('invokeTool routes builtin:<id> to agents_invoke_builtin_tool Tauri command', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ echoed: true } as never);

    const result = await invokeTool('builtin:echo', { x: 1 });

    expect(invoke).toHaveBeenCalledWith('agents_invoke_builtin_tool', {
      id: 'echo',
      args: { x: 1 },
    });
    expect(result).toEqual({ echoed: true });
  });
});

// ── 14. invokeTool routes ext:<id> to extension worker iframe ────────────────

describe('invokeTool tier2 routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('invokeTool posts asyar:tools:invoke to worker iframe and resolves with response', async () => {
    // Set up a fake iframe with a contentWindow that captures postMessage calls.
    const postedMessages: unknown[] = [];
    const fakeContentWindow = {
      postMessage: vi.fn((msg: unknown) => {
        postedMessages.push(msg);
        // Simulate the iframe responding asynchronously.
        setTimeout(() => {
          window.dispatchEvent(
            new MessageEvent('message', {
              data: {
                type: 'asyar:tools:invoke:response',
                messageId: (msg as { messageId: string }).messageId,
                result: { answer: 42 },
              },
            }),
          );
        }, 0);
      }),
    };
    vi.mocked(pickExtensionIframe).mockReturnValue({
      contentWindow: fakeContentWindow,
    } as unknown as HTMLIFrameElement);

    const result = await invokeTool('ext.foo:bar', { y: 2 });

    expect(pickExtensionIframe).toHaveBeenCalledWith('ext.foo', 'worker');
    expect(fakeContentWindow.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'asyar:tools:invoke',
        payload: expect.objectContaining({ id: 'bar', args: { y: 2 } }),
      }),
      '*',
    );
    expect(result).toEqual({ answer: 42 });
  });

  // ── 15. invokeTool errors when extension iframe is not mounted ────────────

  it('invokeTool rejects with a clear error when extension iframe is not mounted', async () => {
    vi.mocked(pickExtensionIframe).mockReturnValue(null);

    await expect(invokeTool('ext.foo:bar', {})).rejects.toThrow(
      /ext\.foo|iframe|not mounted|not found/i,
    );
  });
});

// ── 16. invokeTool rejects ill-formed fully-qualified id ─────────────────────

describe('invokeTool id validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('invokeTool rejects an id without a colon separator', async () => {
    await expect(invokeTool('no-colon-here', {})).rejects.toThrow(
      /invalid|ill-formed|malformed|colon|format/i,
    );
  });
});
