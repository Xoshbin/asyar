import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We need to reset the singleton between tests, so we import the module dynamically
// after mocking dependencies.

// Mock the MessageBroker module singleton
vi.mock('./ipc/MessageBroker', () => {
  const handlers = new Map<string, Function>();
  return {
    messageBroker: {
      on: (type: string, handler: Function) => handlers.set(type, handler),
      send: vi.fn(),
    },
    // Expose for test assertions
    __handlers: handlers,
  };
});

describe('ExtensionBridge search IPC', () => {
  let postMessageSpy: ReturnType<typeof vi.fn>;
  let messageHandler: ((event: MessageEvent) => void) | undefined;

  beforeEach(() => {
    // Reset the singleton by clearing the module cache
    vi.resetModules();

    postMessageSpy = vi.fn();

    // Capture the message event listener that ExtensionBridge installs
    vi.spyOn(window, 'addEventListener').mockImplementation((type, handler) => {
      if (type === 'message') {
        messageHandler = handler as (event: MessageEvent) => void;
      }
    });

    // Mock window.parent.postMessage
    Object.defineProperty(window, 'parent', {
      value: { postMessage: postMessageSpy },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    messageHandler = undefined;
  });

  it('responds to asyar:search:request with results from registered extension', async () => {
    // Import fresh to trigger singleton creation
    const { extensionBridge: bridge } = await import('./ExtensionBridge');

    // Register a manifest and extension with a search method
    bridge.registerManifest({
      id: 'test-ext',
      name: 'Test Extension',
      version: '1.0.0',
      description: 'Test',
      type: 'extension',
      searchable: true,
      commands: [],
    });

    bridge.registerExtensionImplementation('test-ext', {
      initialize: vi.fn(),
      activate: vi.fn(),
      deactivate: vi.fn(),
      onUnload: vi.fn(),
      executeCommand: vi.fn(),
      search: vi.fn().mockResolvedValue([
        {
          title: 'Test Result',
          subtitle: 'A test doc',
          score: 0.9,
          type: 'view',
          icon: '📖',
          viewPath: 'test-ext/TestView',
          action: () => {},
        },
      ]),
    });

    expect(messageHandler).toBeDefined();

    // Simulate host sending asyar:search:request
    const event = new MessageEvent('message', {
      data: {
        type: 'asyar:search:request',
        messageId: 'search_123',
        payload: { query: 'test' },
      },
      source: window.parent,
    });

    messageHandler!(event);

    // Wait for async search to complete
    await vi.waitFor(() => {
      expect(postMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'asyar:search:response',
          messageId: 'search_123',
          result: expect.arrayContaining([
            expect.objectContaining({
              title: 'Test Result',
              subtitle: 'A test doc',
              score: 0.9,
            }),
          ]),
        }),
        '*'
      );
    });
  });

  it('responds with empty results when no extension implements search', async () => {
    const { extensionBridge: bridge } = await import('./ExtensionBridge');

    // Register extension WITHOUT search method
    bridge.registerManifest({
      id: 'no-search-ext',
      name: 'No Search',
      version: '1.0.0',
      description: 'Test',
      type: 'extension',
      commands: [],
    });

    bridge.registerExtensionImplementation('no-search-ext', {
      initialize: vi.fn(),
      activate: vi.fn(),
      deactivate: vi.fn(),
      onUnload: vi.fn(),
      executeCommand: vi.fn(),
    });

    expect(messageHandler).toBeDefined();

    const event = new MessageEvent('message', {
      data: {
        type: 'asyar:search:request',
        messageId: 'search_456',
        payload: { query: 'test' },
      },
      source: window.parent,
    });

    messageHandler!(event);

    await vi.waitFor(() => {
      expect(postMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'asyar:search:response',
          messageId: 'search_456',
          result: [],
        }),
        '*'
      );
    });
  });

  it('strips action functions from search results (not serializable via postMessage)', async () => {
    const { extensionBridge: bridge } = await import('./ExtensionBridge');

    bridge.registerManifest({
      id: 'strip-ext',
      name: 'Strip Test',
      version: '1.0.0',
      description: 'Test',
      type: 'extension',
      commands: [],
    });

    bridge.registerExtensionImplementation('strip-ext', {
      initialize: vi.fn(),
      activate: vi.fn(),
      deactivate: vi.fn(),
      onUnload: vi.fn(),
      executeCommand: vi.fn(),
      search: vi.fn().mockResolvedValue([
        {
          title: 'Doc',
          score: 0.5,
          type: 'view',
          action: () => console.log('should be stripped'),
          viewPath: 'strip-ext/View',
        },
      ]),
    });

    expect(messageHandler).toBeDefined();

    const event = new MessageEvent('message', {
      data: {
        type: 'asyar:search:request',
        messageId: 'search_789',
        payload: { query: 'doc' },
      },
      source: window.parent,
    });

    messageHandler!(event);

    await vi.waitFor(() => {
      expect(postMessageSpy).toHaveBeenCalled();
      const call = postMessageSpy.mock.calls[0];
      const result = call[0].result[0];
      expect(result.title).toBe('Doc');
      // action should NOT be present in the serialized result
      expect(result).not.toHaveProperty('action');
    });
  });
});

describe('ExtensionBridge registerActionHandler', () => {
  let messageHandler: ((event: MessageEvent) => void) | undefined;

  beforeEach(() => {
    vi.resetModules();
    vi.spyOn(window, 'addEventListener').mockImplementation((type, handler) => {
      if (type === 'message') {
        messageHandler = handler as (event: MessageEvent) => void;
      }
    });
    Object.defineProperty(window, 'parent', {
      value: { postMessage: vi.fn() },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    messageHandler = undefined;
  });

  it('stores handler in actionRegistry with full action ID', async () => {
    const { extensionBridge: bridge } = await import('./ExtensionBridge');
    const handler = vi.fn();

    bridge.registerActionHandler('com.example.github', 'open-browser', handler);

    const actions = bridge.getActions();
    const found = actions.find(a => a.id === 'act_com.example.github_open-browser');
    expect(found).toBeDefined();
    expect(found!.extensionId).toBe('com.example.github');
  });

  it('handler is invoked when asyar:action:execute message arrives', async () => {
    const { extensionBridge: bridge } = await import('./ExtensionBridge');
    const handler = vi.fn();

    bridge.registerActionHandler('com.example.github', 'open-browser', handler);

    expect(messageHandler).toBeDefined();

    const event = new MessageEvent('message', {
      data: {
        type: 'asyar:action:execute',
        payload: { actionId: 'act_com.example.github_open-browser' },
      },
      source: window.parent,
    });

    messageHandler!(event);

    await vi.waitFor(() => {
      expect(handler).toHaveBeenCalledOnce();
    });
  });

  it('does not invoke handler for non-matching action ID', async () => {
    const { extensionBridge: bridge } = await import('./ExtensionBridge');
    const handler = vi.fn();

    bridge.registerActionHandler('com.example.github', 'open-browser', handler);

    const event = new MessageEvent('message', {
      data: {
        type: 'asyar:action:execute',
        payload: { actionId: 'act_com.example.github_wrong-action' },
      },
      source: window.parent,
    });

    messageHandler!(event);

    // Give it a tick to process
    await new Promise(r => setTimeout(r, 10));
    expect(handler).not.toHaveBeenCalled();
  });
});

// Bridge-internal bookkeeping logs (registerManifest, registerExtensionImplementation,
// registerAction, registerActionHandler, registerCommand) must route through
// `console.debug` instead of `LogServiceProxy`. The bridge's logger was never
// patched with an extensionId in the worker context — `WorkerExtensionContext`
// deliberately does not override `notifyBridgeIfAvailable`, since the bridge's
// preferences listener and key forwarder are view-only concerns. Routing
// bookkeeping logs through the proxy would fire `asyar:api:log:debug` with no
// extensionId, and the launcher's `ExtensionIpcRouter` would reject them as
// untrusted-frame messages — producing stderr noise on every worker mount.
describe('ExtensionBridge bookkeeping logs use identity-agnostic console.debug', () => {
  let consoleDebugSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    vi.spyOn(window, 'addEventListener').mockImplementation(() => {});
    Object.defineProperty(window, 'parent', {
      value: { postMessage: vi.fn() },
      writable: true,
      configurable: true,
    });
    consoleDebugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const manifest = {
    id: 'log-test-ext',
    name: 'Log Test',
    version: '1.0.0',
    description: 'Test',
    type: 'extension' as const,
    commands: [],
  };

  it('registerManifest logs via console.debug', async () => {
    const { extensionBridge: bridge } = await import('./ExtensionBridge');
    consoleDebugSpy.mockClear();

    bridge.registerManifest(manifest);

    expect(consoleDebugSpy).toHaveBeenCalledWith(
      expect.stringContaining('log-test-ext'),
    );
  });

  it('registerExtensionImplementation logs via console.debug', async () => {
    const { extensionBridge: bridge } = await import('./ExtensionBridge');
    bridge.registerManifest(manifest);
    consoleDebugSpy.mockClear();

    bridge.registerExtensionImplementation('log-test-ext', {
      initialize: vi.fn(),
      activate: vi.fn(),
      deactivate: vi.fn(),
      onUnload: vi.fn(),
      executeCommand: vi.fn(),
    });

    expect(consoleDebugSpy).toHaveBeenCalledWith(
      expect.stringContaining('log-test-ext'),
    );
  });

  it('registerAction logs via console.debug', async () => {
    const { extensionBridge: bridge } = await import('./ExtensionBridge');
    consoleDebugSpy.mockClear();

    bridge.registerAction('log-test-ext', {
      id: 'do-thing',
      title: 'Do Thing',
      extensionId: 'log-test-ext',
      execute: vi.fn(),
    });

    expect(consoleDebugSpy).toHaveBeenCalledWith(
      expect.stringContaining('do-thing'),
    );
  });

  it('registerActionHandler logs via console.debug', async () => {
    const { extensionBridge: bridge } = await import('./ExtensionBridge');
    consoleDebugSpy.mockClear();

    bridge.registerActionHandler('log-test-ext', 'do-thing', vi.fn());

    expect(consoleDebugSpy).toHaveBeenCalledWith(
      expect.stringContaining('act_log-test-ext_do-thing'),
    );
  });

  it('registerCommand logs via console.debug', async () => {
    const { extensionBridge: bridge } = await import('./ExtensionBridge');
    consoleDebugSpy.mockClear();

    bridge.registerCommand('log-test-ext.do-thing', { execute: vi.fn() }, 'log-test-ext');

    expect(consoleDebugSpy).toHaveBeenCalledWith(
      expect.stringContaining('log-test-ext.do-thing'),
    );
  });
});
