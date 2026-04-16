import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ExtensionSyncProvider } from '../types/SyncType';

function createMockProvider(overrides?: Partial<ExtensionSyncProvider>): ExtensionSyncProvider {
  return {
    displayName: 'Test Provider',
    sensitiveFields: ['secret'],
    defaultEnabled: true,
    export: vi.fn().mockResolvedValue({ key: 'value' }),
    import: vi.fn().mockResolvedValue(undefined),
    preview: vi.fn().mockResolvedValue({ localCount: 3, incomingCount: 5 }),
    ...overrides,
  };
}

describe('registerSyncProvider', () => {
  let postMessageSpy: ReturnType<typeof vi.fn>;
  let addEventListenerSpy: ReturnType<typeof vi.spyOn>;
  let messageHandler: ((event: MessageEvent) => void) | undefined;

  beforeEach(() => {
    vi.resetModules();
    postMessageSpy = vi.fn();
    vi.stubGlobal('parent', { postMessage: postMessageSpy });

    messageHandler = undefined;
    addEventListenerSpy = vi.spyOn(window, 'addEventListener').mockImplementation(
      (event: string, handler: any) => {
        if (event === 'message') messageHandler = handler;
      },
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('sends asyar:sync:register postMessage with provider metadata', async () => {
    const { registerSyncProvider } = await import('./syncProviderBridge');
    const provider = createMockProvider();

    registerSyncProvider('ext-abc', provider);

    expect(postMessageSpy).toHaveBeenCalledWith(
      {
        type: 'asyar:sync:register',
        extensionId: 'ext-abc',
        payload: {
          displayName: 'Test Provider',
          sensitiveFields: ['secret'],
          defaultEnabled: true,
        },
      },
      '*',
    );
  });

  it('defaults sensitiveFields to [] and defaultEnabled to true when omitted', async () => {
    const { registerSyncProvider } = await import('./syncProviderBridge');
    const provider = createMockProvider({
      sensitiveFields: undefined,
      defaultEnabled: undefined,
    });

    registerSyncProvider('ext-abc', provider);

    expect(postMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: {
          displayName: 'Test Provider',
          sensitiveFields: [],
          defaultEnabled: true,
        },
      }),
      '*',
    );
  });

  it('registers a message event listener on window', async () => {
    const { registerSyncProvider } = await import('./syncProviderBridge');
    registerSyncProvider('ext-abc', createMockProvider());

    expect(addEventListenerSpy).toHaveBeenCalledWith('message', expect.any(Function));
    expect(messageHandler).toBeDefined();
  });

  // ---- export handler ----
  it('handles asyar:sync:export and posts success response', async () => {
    const { registerSyncProvider } = await import('./syncProviderBridge');
    const provider = createMockProvider();
    registerSyncProvider('ext-abc', provider);
    postMessageSpy.mockClear();

    const event = new MessageEvent('message', {
      data: { type: 'asyar:sync:export', extensionId: 'ext-abc', messageId: 'msg-1' },
    });
    messageHandler!(event);

    await vi.waitFor(() => {
      expect(postMessageSpy).toHaveBeenCalledWith(
        {
          type: 'asyar:sync:export:response',
          extensionId: 'ext-abc',
          messageId: 'msg-1',
          payload: { key: 'value' },
          success: true,
        },
        '*',
      );
    });
  });

  it('handles asyar:sync:export error and posts failure response', async () => {
    const { registerSyncProvider } = await import('./syncProviderBridge');
    const provider = createMockProvider({
      export: vi.fn().mockRejectedValue(new Error('export failed')),
    });
    registerSyncProvider('ext-abc', provider);
    postMessageSpy.mockClear();

    const event = new MessageEvent('message', {
      data: { type: 'asyar:sync:export', extensionId: 'ext-abc', messageId: 'msg-1' },
    });
    messageHandler!(event);

    await vi.waitFor(() => {
      expect(postMessageSpy).toHaveBeenCalledWith(
        {
          type: 'asyar:sync:export:response',
          extensionId: 'ext-abc',
          messageId: 'msg-1',
          success: false,
          error: 'Error: export failed',
        },
        '*',
      );
    });
  });

  // ---- import handler ----
  it('handles asyar:sync:import and posts success response', async () => {
    const { registerSyncProvider } = await import('./syncProviderBridge');
    const provider = createMockProvider();
    registerSyncProvider('ext-abc', provider);
    postMessageSpy.mockClear();

    const event = new MessageEvent('message', {
      data: {
        type: 'asyar:sync:import',
        extensionId: 'ext-abc',
        messageId: 'msg-2',
        payload: { data: { imported: true }, strategy: 'merge' },
      },
    });
    messageHandler!(event);

    await vi.waitFor(() => {
      expect(provider.import).toHaveBeenCalledWith({ imported: true }, 'merge');
      expect(postMessageSpy).toHaveBeenCalledWith(
        {
          type: 'asyar:sync:import:response',
          extensionId: 'ext-abc',
          messageId: 'msg-2',
          success: true,
        },
        '*',
      );
    });
  });

  it('handles asyar:sync:import error and posts failure response', async () => {
    const { registerSyncProvider } = await import('./syncProviderBridge');
    const provider = createMockProvider({
      import: vi.fn().mockRejectedValue(new Error('import failed')),
    });
    registerSyncProvider('ext-abc', provider);
    postMessageSpy.mockClear();

    const event = new MessageEvent('message', {
      data: {
        type: 'asyar:sync:import',
        extensionId: 'ext-abc',
        messageId: 'msg-2',
        payload: { data: { imported: true }, strategy: 'replace' },
      },
    });
    messageHandler!(event);

    await vi.waitFor(() => {
      expect(postMessageSpy).toHaveBeenCalledWith(
        {
          type: 'asyar:sync:import:response',
          extensionId: 'ext-abc',
          messageId: 'msg-2',
          success: false,
          error: 'Error: import failed',
        },
        '*',
      );
    });
  });

  // ---- preview handler ----
  it('handles asyar:sync:preview and posts success response', async () => {
    const { registerSyncProvider } = await import('./syncProviderBridge');
    const provider = createMockProvider();
    registerSyncProvider('ext-abc', provider);
    postMessageSpy.mockClear();

    const event = new MessageEvent('message', {
      data: {
        type: 'asyar:sync:preview',
        extensionId: 'ext-abc',
        messageId: 'msg-3',
        payload: { data: { some: 'data' } },
      },
    });
    messageHandler!(event);

    await vi.waitFor(() => {
      expect(provider.preview).toHaveBeenCalledWith({ some: 'data' });
      expect(postMessageSpy).toHaveBeenCalledWith(
        {
          type: 'asyar:sync:preview:response',
          extensionId: 'ext-abc',
          messageId: 'msg-3',
          payload: { localCount: 3, incomingCount: 5 },
          success: true,
        },
        '*',
      );
    });
  });

  it('handles asyar:sync:preview error and posts failure response', async () => {
    const { registerSyncProvider } = await import('./syncProviderBridge');
    const provider = createMockProvider({
      preview: vi.fn().mockRejectedValue(new Error('preview failed')),
    });
    registerSyncProvider('ext-abc', provider);
    postMessageSpy.mockClear();

    const event = new MessageEvent('message', {
      data: {
        type: 'asyar:sync:preview',
        extensionId: 'ext-abc',
        messageId: 'msg-3',
        payload: { data: { some: 'data' } },
      },
    });
    messageHandler!(event);

    await vi.waitFor(() => {
      expect(postMessageSpy).toHaveBeenCalledWith(
        {
          type: 'asyar:sync:preview:response',
          extensionId: 'ext-abc',
          messageId: 'msg-3',
          success: false,
          error: 'Error: preview failed',
        },
        '*',
      );
    });
  });

  // ---- extensionId filtering ----
  it('ignores messages for a different extensionId', async () => {
    const { registerSyncProvider } = await import('./syncProviderBridge');
    const provider = createMockProvider();
    registerSyncProvider('ext-abc', provider);
    postMessageSpy.mockClear();

    const event = new MessageEvent('message', {
      data: { type: 'asyar:sync:export', extensionId: 'ext-OTHER', messageId: 'msg-x' },
    });
    messageHandler!(event);

    // Give any potential async handler time to run
    await new Promise((r) => setTimeout(r, 50));

    expect(provider.export).not.toHaveBeenCalled();
    expect(postMessageSpy).not.toHaveBeenCalled();
  });

  it('ignores messages with unrelated type', async () => {
    const { registerSyncProvider } = await import('./syncProviderBridge');
    const provider = createMockProvider();
    registerSyncProvider('ext-abc', provider);
    postMessageSpy.mockClear();

    const event = new MessageEvent('message', {
      data: { type: 'asyar:some:other', extensionId: 'ext-abc', messageId: 'msg-x' },
    });
    messageHandler!(event);

    await new Promise((r) => setTimeout(r, 50));

    expect(provider.export).not.toHaveBeenCalled();
    expect(provider.import).not.toHaveBeenCalled();
    expect(provider.preview).not.toHaveBeenCalled();
    expect(postMessageSpy).not.toHaveBeenCalled();
  });
});
