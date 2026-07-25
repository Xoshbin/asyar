/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { messageBroker } from 'asyar-sdk/contracts';

vi.mock('../log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('./extensionIframeManager.svelte', () => ({
  extensionIframeManager: { handleSearchResponse: vi.fn() },
}));
vi.mock('./extensionPreferencesService.svelte', () => ({
  extensionPreferencesService: { getEffectivePreferences: vi.fn() },
}));
vi.mock('./streamDispatcher.svelte', () => ({ streamDispatcher: { abort: vi.fn() } }));
vi.mock('../../lib/ipc/commands', () => ({
  checkExtensionPermission: vi.fn(),
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('../feedback/feedbackService.svelte', () => ({
  feedbackService: { report: vi.fn() },
}));
vi.mock('../settings/developerSettingsService.svelte', () => ({
  developerSettingsService: { isDeveloperMode: false, tracing: false },
}));

import { invoke } from '@tauri-apps/api/core';
import * as commands from '../../lib/ipc/commands';
import { ExtensionIpcRouter } from './ExtensionIpcRouter';
import type { ServiceRegistry } from './defineServiceRegistry';
import { logService } from '../log/logService';
import { extensionPreferencesService } from './extensionPreferencesService.svelte';
import { streamDispatcher } from './streamDispatcher.svelte';

describe('ExtensionIpcRouter — externally consumed responses', () => {
  beforeEach(() => vi.clearAllMocks());

  it('leaves Tier 2 tool responses to the agent bridge without warning or replying', async () => {
    const postMessage = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
    const router = new ExtensionIpcRouter({} as ServiceRegistry, vi.fn(), vi.fn(), vi.fn());
    router.setup();

    window.dispatchEvent(
      new MessageEvent('message', {
        source: window,
        data: {
          type: 'asyar:tools:invoke:response',
          messageId: 'tool-1',
          result: { words: 5 },
        },
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(logService.warn).not.toHaveBeenCalledWith(
      expect.stringContaining('Unhandled message type'),
    );
    expect(postMessage).not.toHaveBeenCalled();
    postMessage.mockRestore();
  });
});

describe('ExtensionIpcRouter — host dispatcher integration', () => {
  beforeEach(() => {
    messageBroker.setHostDispatcher(null);
  });

  it('installs a host dispatcher on the SDK broker that routes through the registry', async () => {
    const navigateToView = vi.fn();
    const registry = { extensions: { navigateToView } } as unknown as ServiceRegistry;
    const router = new ExtensionIpcRouter(registry, vi.fn(), vi.fn(), vi.fn());
    router.setup();

    await messageBroker.invoke('extensions:navigateToView', { viewPath: 'store/DefaultView' });

    expect(navigateToView).toHaveBeenCalledWith('store/DefaultView');
  });

  it('propagates service method errors back to invoke() callers', async () => {
    const registry = {
      extensions: {
        navigateToView: () => {
          throw new Error('nav-boom');
        },
      },
    } as unknown as ServiceRegistry;
    const router = new ExtensionIpcRouter(registry, vi.fn(), vi.fn(), vi.fn());
    router.setup();

    await expect(
      messageBroker.invoke('extensions:navigateToView', { viewPath: 'x/V' }),
    ).rejects.toThrow('nav-boom');
  });

  it('runs the service method synchronously — side effects land before invoke() resolves', async () => {
    let pushed = false;
    const registry = {
      extensions: {
        navigateToView: () => {
          pushed = true;
        },
      },
    } as unknown as ServiceRegistry;
    const router = new ExtensionIpcRouter(registry, vi.fn(), vi.fn(), vi.fn());
    router.setup();

    const promise = messageBroker.invoke('extensions:navigateToView', { viewPath: 'x/V' });

    expect(pushed).toBe(true);
    await promise;
  });
});

describe('ExtensionIpcRouter — auto-inject extensionId for fsWatcher', () => {
  // Regression: fsWatcher's `create` and `dispose` host methods take
  // extensionId as their first argument. Missing the namespace from
  // INJECTS_EXTENSION_ID would route the SDK proxy's `{ paths, opts }`
  // payload's first value (the paths array) into the extensionId slot,
  // which surfaces as the cryptic Rust error
  // `invalid type: sequence, expected a string` from `fs_watch_create`.
  // Exercises the iframe-context dispatch path directly (the bug only
  // manifests for iframe callers; privileged-host calls correctly skip
  // the inject because they have no extensionId).

  type DispatchApiCall = (
    type: string,
    payload: unknown,
    extensionId: string | undefined,
    isPrivilegedHostContext: boolean,
  ) => Promise<unknown>;

  function dispatchAs(router: ExtensionIpcRouter): DispatchApiCall {
    return (
      router as unknown as {
        dispatchApiCall: DispatchApiCall;
      }
    ).dispatchApiCall.bind(router);
  }

  it('fsWatcher:create from an iframe receives extensionId, paths, opts in that order', async () => {
    const create = vi.fn(async () => 'handle-1');
    const registry = {
      fsWatcher: { create, dispose: vi.fn() },
    } as unknown as ServiceRegistry;
    const router = new ExtensionIpcRouter(registry, vi.fn(), vi.fn(), vi.fn());

    await dispatchAs(router)(
      'asyar:api:fsWatcher:create',
      { paths: ['/tmp/asyar-fs-watch'], opts: { recursive: true } },
      'ext.demo',
      false,
    );

    expect(create).toHaveBeenCalledWith('ext.demo', ['/tmp/asyar-fs-watch'], { recursive: true });
  });

  it('fsWatcher:dispose from an iframe receives extensionId, handleId in that order', async () => {
    const dispose = vi.fn(async () => undefined);
    const registry = {
      fsWatcher: { create: vi.fn(), dispose },
    } as unknown as ServiceRegistry;
    const router = new ExtensionIpcRouter(registry, vi.fn(), vi.fn(), vi.fn());

    await dispatchAs(router)(
      'asyar:api:fsWatcher:dispose',
      { handleId: 'h-abc' },
      'ext.demo',
      false,
    );

    expect(dispose).toHaveBeenCalledWith('ext.demo', 'h-abc');
  });
});

describe('ExtensionIpcRouter — auto-inject extensionId for tools', () => {
  // Regression: tools.registerTool / unregisterTool host methods take
  // extensionId as their first argument. Missing the namespace from
  // INJECTS_EXTENSION_ID would route the SDK proxy's `{ tool }` payload's
  // first value (the tool object) into the extensionId slot, leaving the
  // tool argument undefined and crashing on `tool.id` access inside
  // buildServiceRegistry.

  type DispatchApiCall = (
    type: string,
    payload: unknown,
    extensionId: string | undefined,
    isPrivilegedHostContext: boolean,
  ) => Promise<unknown>;

  function dispatchAs(router: ExtensionIpcRouter): DispatchApiCall {
    return (router as unknown as { dispatchApiCall: DispatchApiCall }).dispatchApiCall.bind(router);
  }

  it('tools:registerTool from an iframe receives extensionId, tool in that order', async () => {
    const registerTool = vi.fn(async () => undefined);
    const registry = {
      tools: { registerTool, unregisterTool: vi.fn(), listTools: vi.fn() },
    } as unknown as ServiceRegistry;
    const router = new ExtensionIpcRouter(registry, vi.fn(), vi.fn(), vi.fn());

    await dispatchAs(router)(
      'asyar:api:tools:registerTool',
      { tool: { id: 'foo', name: 'Foo', description: 'd', inputSchema: {} } },
      'ext.demo',
      false,
    );

    expect(registerTool).toHaveBeenCalledWith('ext.demo', {
      id: 'foo',
      name: 'Foo',
      description: 'd',
      inputSchema: {},
    });
  });

  it('tools:unregisterTool from an iframe receives extensionId, id in that order', async () => {
    const unregisterTool = vi.fn(async () => undefined);
    const registry = {
      tools: { registerTool: vi.fn(), unregisterTool, listTools: vi.fn() },
    } as unknown as ServiceRegistry;
    const router = new ExtensionIpcRouter(registry, vi.fn(), vi.fn(), vi.fn());

    await dispatchAs(router)('asyar:api:tools:unregisterTool', { id: 'foo' }, 'ext.demo', false);

    expect(unregisterTool).toHaveBeenCalledWith('ext.demo', 'foo');
  });
});

describe('ExtensionIpcRouter — auto-inject extensionId for applicationIndex', () => {
  // Regression: applicationIndex.subscribe / unsubscribe accept the caller's
  // extensionId as the first arg (nullable for privileged host). Without
  // applicationIndex in ALWAYS_INJECTS_CALLER_ID the SDK proxy's payload
  // would land in the extensionId slot and the Rust hub would receive the
  // wrong type for `extension_id`.

  type DispatchApiCall = (
    type: string,
    payload: unknown,
    extensionId: string | undefined,
    isPrivilegedHostContext: boolean,
  ) => Promise<unknown>;

  function dispatchAs(router: ExtensionIpcRouter): DispatchApiCall {
    return (router as unknown as { dispatchApiCall: DispatchApiCall }).dispatchApiCall.bind(router);
  }

  it('applicationIndex:subscribe from an iframe receives extensionId, eventTypes in that order', async () => {
    const subscribe = vi.fn(async () => 'sub-1');
    const registry = {
      applicationIndex: { subscribe, unsubscribe: vi.fn() },
    } as unknown as ServiceRegistry;
    const router = new ExtensionIpcRouter(registry, vi.fn(), vi.fn(), vi.fn());

    await dispatchAs(router)(
      'asyar:api:applicationIndex:subscribe',
      { eventTypes: ['installed', 'removed'] },
      'ext.demo',
      false,
    );

    expect(subscribe).toHaveBeenCalledWith('ext.demo', ['installed', 'removed']);
  });

  it('applicationIndex:subscribe from privileged host context receives null as the first arg', async () => {
    const subscribe = vi.fn(async () => 'sub-2');
    const registry = {
      applicationIndex: { subscribe, unsubscribe: vi.fn() },
    } as unknown as ServiceRegistry;
    const router = new ExtensionIpcRouter(registry, vi.fn(), vi.fn(), vi.fn());

    await dispatchAs(router)(
      'asyar:api:applicationIndex:subscribe',
      { eventTypes: ['installed'] },
      undefined,
      true,
    );

    expect(subscribe).toHaveBeenCalledWith(null, ['installed']);
  });
});

describe('ExtensionIpcRouter — originRole injection for shell streams', () => {
  // Streamed APIs route chunks back through `streamDispatcher`, which prefers
  // the originating iframe's role. For that to work, the origin role has to
  // travel from the IPC source (the iframe `event.source`) down to
  // `streamDispatcher.create()` via shell.spawn / shell.attach. This test
  // pins the args contract so a future refactor can't silently drop the role
  // and re-introduce the worker-stream-lands-in-view bug.

  type DispatchApiCall = (
    type: string,
    payload: unknown,
    extensionId: string | undefined,
    isPrivilegedHostContext: boolean,
    originRole?: 'view' | 'worker',
  ) => Promise<unknown>;

  function dispatchAs(router: ExtensionIpcRouter): DispatchApiCall {
    return (router as unknown as { dispatchApiCall: DispatchApiCall }).dispatchApiCall.bind(router);
  }

  it('shell:spawn from a worker iframe receives originRole as the trailing argument', async () => {
    const spawn = vi.fn(async () => ({ streaming: true }));
    const registry = {
      shell: { spawn, attach: vi.fn(), list: vi.fn() },
    } as unknown as ServiceRegistry;
    const router = new ExtensionIpcRouter(registry, vi.fn(), vi.fn(), vi.fn());

    await dispatchAs(router)(
      'asyar:api:shell:spawn',
      { program: 'ls', args: ['-la'], spawnId: 'sp-1' },
      'ext.demo',
      false,
      'worker',
    );

    expect(spawn).toHaveBeenCalledWith('ext.demo', 'ls', ['-la'], 'sp-1', 'worker');
  });

  it('shell:attach from a view iframe receives originRole=view as the trailing argument', async () => {
    const attach = vi.fn(async () => ({ spawnId: 'sp-2' }));
    const registry = {
      shell: { spawn: vi.fn(), attach, list: vi.fn() },
    } as unknown as ServiceRegistry;
    const router = new ExtensionIpcRouter(registry, vi.fn(), vi.fn(), vi.fn());

    await dispatchAs(router)(
      'asyar:api:shell:attach',
      { spawnId: 'sp-2' },
      'ext.demo',
      false,
      'view',
    );

    expect(attach).toHaveBeenCalledWith('ext.demo', 'sp-2', 'view');
  });

  it('shell:spawn without originRole does not append a trailing argument', async () => {
    // Privileged host calls pass undefined; the role must not leak as a
    // trailing `undefined` arg into the service method.
    const spawn = vi.fn(async () => ({ streaming: true }));
    const registry = {
      shell: { spawn, attach: vi.fn(), list: vi.fn() },
    } as unknown as ServiceRegistry;
    const router = new ExtensionIpcRouter(registry, vi.fn(), vi.fn(), vi.fn());

    await dispatchAs(router)(
      'asyar:api:shell:spawn',
      { program: 'ls', args: [], spawnId: 'sp-3' },
      'ext.demo',
      false,
    );

    expect(spawn).toHaveBeenCalledWith('ext.demo', 'ls', [], 'sp-3');
    expect(spawn.mock.calls[0]).toHaveLength(4);
  });

  it('non-streaming shell methods do not receive originRole', async () => {
    // Only `spawn` and `attach` open a stream; `list` is a one-shot and
    // must not get the trailing role argument tacked on.
    const list = vi.fn(async () => []);
    const registry = {
      shell: { spawn: vi.fn(), attach: vi.fn(), list },
    } as unknown as ServiceRegistry;
    const router = new ExtensionIpcRouter(registry, vi.fn(), vi.fn(), vi.fn());

    await dispatchAs(router)('asyar:api:shell:list', {}, 'ext.demo', false, 'worker');

    expect(list).toHaveBeenCalledWith('ext.demo');
    expect(list.mock.calls[0]).toHaveLength(1);
  });

  it('non-shell namespaces never receive originRole even when one is provided', async () => {
    // The role-injection guard is scoped to `shell` — other namespaces must
    // be unaffected. Ensures the guard at dispatchApiCall doesn't broaden.
    const navigateToView = vi.fn();
    const registry = {
      extensions: { navigateToView },
    } as unknown as ServiceRegistry;
    const router = new ExtensionIpcRouter(registry, vi.fn(), vi.fn(), vi.fn());

    await dispatchAs(router)(
      'asyar:api:extensions:navigateToView',
      { viewPath: 'store/Default' },
      'ext.demo',
      false,
      'worker',
    );

    expect(navigateToView).toHaveBeenCalledWith('store/Default');
    expect(navigateToView.mock.calls[0]).toHaveLength(1);
  });
});

describe('ExtensionIpcRouter — snippets Tauri-direct routing', () => {
  type DispatchApiCall = (
    type: string,
    payload: unknown,
    extensionId: string | undefined,
    isPrivilegedHostContext: boolean,
  ) => Promise<unknown>;

  function dispatchAs(router: ExtensionIpcRouter): DispatchApiCall {
    return (router as unknown as { dispatchApiCall: DispatchApiCall }).dispatchApiCall.bind(router);
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('forwards snippets:registerShortcodes to contribute_shortcodes Tauri command', async () => {
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);
    const registry = {} as unknown as ServiceRegistry;
    const router = new ExtensionIpcRouter(registry, vi.fn(), vi.fn(), vi.fn());

    await dispatchAs(router)(
      'asyar:api:snippets:registerShortcodes',
      { map: { ':party:': '🎉' } },
      'org.asyar.emoji',
      false,
    );

    expect(invoke).toHaveBeenCalledWith('contribute_shortcodes', {
      extensionId: 'org.asyar.emoji',
      map: { ':party:': '🎉' },
    });
  });

  it('forwards snippets:unregisterShortcodes to revoke_shortcodes Tauri command', async () => {
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);
    const registry = {} as unknown as ServiceRegistry;
    const router = new ExtensionIpcRouter(registry, vi.fn(), vi.fn(), vi.fn());

    await dispatchAs(router)(
      'asyar:api:snippets:unregisterShortcodes',
      {},
      'org.asyar.emoji',
      false,
    );

    expect(invoke).toHaveBeenCalledWith('revoke_shortcodes', {
      extensionId: 'org.asyar.emoji',
    });
  });
});

describe('ExtensionIpcRouter — identity spoofing prevention', () => {
  // Regression: before the fix, extensionId was read from the postMessage
  // payload itself (event.data.extensionId || payload?.extensionId).  A
  // malicious extension could therefore claim any other extension's ID in
  // the message body and inherit that extension's storage namespace,
  // permissions, and service access.
  //
  // After the fix, extensionId for iframe contexts is always derived from
  // the host-set `data-extension-id` DOM attribute of the iframe whose
  // contentWindow === event.source.  Extensions cannot write to that
  // attribute, so the identity is authoritative regardless of what the
  // payload claims.

  let iframeEl: HTMLIFrameElement;

  beforeEach(() => {
    vi.clearAllMocks();
    // Clean up any iframe we added to the document in a previous test.
    document.querySelectorAll('iframe[data-extension-id]').forEach((el) => el.remove());

    // Create a real JSDOM iframe element with the legitimate extension's ID
    // stamped as a host-set attribute.  The router reads this via
    // findExtensionIdForSource(), which matches iframe.contentWindow === event.source.
    iframeEl = document.createElement('iframe');
    iframeEl.setAttribute('data-extension-id', 'org.asyar.legitimate');
    iframeEl.setAttribute('data-role', 'view');
    document.body.appendChild(iframeEl);
  });

  afterEach(() => {
    iframeEl?.remove();
  });

  it('uses the DOM-derived extensionId, not the spoofed payload extensionId, for permission check', async () => {
    // Arrange: permission check allows any call (we are only checking WHICH id was used).
    vi.mocked(commands.checkExtensionPermission).mockResolvedValue({ allowed: true } as any);

    const getManifestById = vi.fn((id: string) =>
      id === 'org.asyar.legitimate' ? { id: 'org.asyar.legitimate' } : undefined,
    ) as any;

    const router = new ExtensionIpcRouter({} as ServiceRegistry, getManifestById, vi.fn(), vi.fn());
    router.setup();

    // Act: fire a message that claims to be the malicious extension in its payload,
    // but is actually sent from the legitimate extension's iframe contentWindow.
    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: 'asyar:api:storage:get',
          // Spoofed — malicious extension claims to be someone else.
          extensionId: 'org.asyar.malicious',
          payload: { key: 'secret' },
          messageId: 'spoof-1',
        },
        // The event.source is the legitimate iframe's contentWindow — this is
        // what the router must use, not the extensionId in the data above.
        source: iframeEl.contentWindow,
      }),
    );

    // Flush microtasks / async handlers.
    await new Promise((resolve) => setTimeout(resolve, 20));

    // Assert: permission was checked against the LEGITIMATE id (from DOM), not the spoofed one.
    expect(commands.checkExtensionPermission).toHaveBeenCalledWith(
      'org.asyar.legitimate',
      expect.any(String),
    );
    expect(commands.checkExtensionPermission).not.toHaveBeenCalledWith(
      'org.asyar.malicious',
      expect.any(String),
    );
  });

  it('uses the DOM-derived extensionId when injecting into service calls', async () => {
    // Arrange: storage.get should receive the legitimate extensionId as its first arg.
    vi.mocked(commands.checkExtensionPermission).mockResolvedValue({ allowed: true } as any);

    const storageGet = vi.fn(async () => 'value');
    const registry = { storage: { get: storageGet } } as unknown as ServiceRegistry;

    const getManifestById = vi.fn((id: string) =>
      id === 'org.asyar.legitimate' ? { id: 'org.asyar.legitimate' } : undefined,
    ) as any;

    const router = new ExtensionIpcRouter(registry, getManifestById, vi.fn(), vi.fn());
    router.setup();

    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: 'asyar:api:storage:get',
          extensionId: 'org.asyar.malicious', // spoofed
          payload: { key: 'myKey' },
          messageId: 'spoof-2',
        },
        source: iframeEl.contentWindow,
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 20));

    // storage.get must be called with the DOM-authoritative ID prepended, not the spoofed one.
    expect(storageGet).toHaveBeenCalledWith('org.asyar.legitimate', 'myKey');
    expect(storageGet).not.toHaveBeenCalledWith('org.asyar.malicious', expect.anything());
  });

  it('rejects the message entirely when the source iframe has no data-extension-id', async () => {
    // An unregistered iframe (no data-extension-id stamp) must be silently dropped.
    const storageGet = vi.fn(async () => 'value');
    const registry = { storage: { get: storageGet } } as unknown as ServiceRegistry;

    const router = new ExtensionIpcRouter(registry, vi.fn(), vi.fn(), vi.fn());
    router.setup();

    // Create an iframe WITHOUT the attribute.
    const unknownIframe = document.createElement('iframe');
    document.body.appendChild(unknownIframe);

    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: 'asyar:api:storage:get',
          extensionId: 'org.asyar.legitimate', // tries to claim a real ID
          payload: { key: 'anyKey' },
          messageId: 'spoof-3',
        },
        source: unknownIframe.contentWindow,
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 20));

    // Neither the permission check nor the service method should have been reached.
    expect(commands.checkExtensionPermission).not.toHaveBeenCalled();
    expect(storageGet).not.toHaveBeenCalled();

    unknownIframe.remove();
  });
});

describe('ExtensionIpcRouter — AppError-shaped rejection messages', () => {
  // Regression: files:glob/read/thumbnail call Tauri's `invoke()` directly
  // (not invokeSafe) so scope/validation failures reject instead of
  // collapsing to null. Those rejections carry the raw serialized AppError
  // object (`{ source, kind, severity, retryable, context, developerDetail }`),
  // not an Error instance. The catch block's `String(error)` fallback turned
  // that into the useless literal "[object Object]" instead of surfacing
  // developerDetail, which is what a caller actually needs to see.
  beforeEach(() => vi.clearAllMocks());

  it('surfaces developerDetail instead of "[object Object]" for a plain AppError-shaped throw', async () => {
    const postMessage = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
    const glob = vi.fn(async () => {
      throw {
        source: 'rust',
        kind: 'validation_failure',
        severity: 'warning',
        retryable: false,
        context: {},
        developerDetail:
          "files:glob pattern must begin with an absolute literal prefix to enumerate from (e.g. 'C:/Steam/appcache/**'), got: 'bad'",
      };
    });
    const registry = { files: { glob } } as unknown as ServiceRegistry;
    const router = new ExtensionIpcRouter(registry, vi.fn(), vi.fn(), vi.fn());
    router.setup();

    window.dispatchEvent(
      new MessageEvent('message', {
        source: window,
        data: {
          type: 'asyar:api:files:glob',
          extensionId: 'org.asyar.demo',
          payload: { pattern: 'bad' },
          messageId: 'glob-1',
        },
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 20));

    // Other test cases in this file each construct their own
    // ExtensionIpcRouter and call setup(), which registers a
    // window-level `message` listener that is never torn down. All of
    // them receive this dispatch too, but only this test's router has a
    // `files` service registered, so its reply is the only one with a
    // populated `error` field — filter for that rather than assuming
    // position.
    const response = postMessage.mock.calls
      .map((call) => call[0] as { type?: string; messageId?: string; error?: string })
      .find((msg) => msg?.messageId === 'glob-1' && msg?.error);

    expect(response?.error).not.toBe('[object Object]');
    expect(response?.error).toContain(
      'files:glob pattern must begin with an absolute literal prefix',
    );

    postMessage.mockRestore();
  });
});

describe('ExtensionIpcRouter — protocol frames bypass the permission gate', () => {
  // Regression: the gate ran on EVERY `asyar:*` message from an iframe, but the
  // Rust gate only classifies the `asyar:api:*` call surface. Once it became
  // fail-closed, transport/lifecycle frames — which are not API calls and have
  // no permission to declare — started being denied with
  // `Permission denied: "asyar:extension:loaded" is required but not declared
  // in manifest.json`, so no extension ever got its preferences bundle.
  let iframeEl: HTMLIFrameElement;

  beforeEach(() => {
    vi.clearAllMocks();
    document.querySelectorAll('iframe[data-extension-id]').forEach((el) => el.remove());
    // Every previously registered router shares this listener, so make the gate
    // deny — exactly what fail-closed Rust does for a non-`asyar:api:` type.
    vi.mocked(commands.checkExtensionPermission).mockResolvedValue({
      allowed: false,
      reason: 'Call is not a recognized extension API — refusing by default (fail closed).',
    } as any);

    iframeEl = document.createElement('iframe');
    iframeEl.setAttribute('data-extension-id', 'org.asyar.demo');
    iframeEl.setAttribute('data-role', 'view');
    document.body.appendChild(iframeEl);
  });

  afterEach(() => iframeEl?.remove());

  const getManifestById = (id: string) => (id === 'org.asyar.demo' ? ({ id } as any) : undefined);

  it('answers asyar:extension:loaded with the preferences bundle instead of denying it', async () => {
    vi.mocked(extensionPreferencesService.getEffectivePreferences).mockResolvedValue({
      extension: { theme: 'dark' },
      commands: {},
    } as any);
    const framePostMessage = vi
      .spyOn(iframeEl.contentWindow as Window, 'postMessage')
      .mockImplementation(() => {});

    const router = new ExtensionIpcRouter(
      {} as ServiceRegistry,
      getManifestById as any,
      vi.fn(),
      vi.fn(),
    );
    router.setup();

    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'asyar:extension:loaded', extensionId: 'org.asyar.demo', role: 'view' },
        source: iframeEl.contentWindow,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));

    // Routers from earlier describes share this window listener and reply
    // "Unknown extension" (their own getManifestById mocks know nothing about
    // org.asyar.demo), so assert on this router's reply, not on "no errors".
    const sent = framePostMessage.mock.calls.map(
      (call) => call[0] as { type?: string; error?: string },
    );
    expect(sent.some((msg) => msg?.type === 'asyar:event:preferences:set-all')).toBe(true);
    expect(sent.some((msg) => msg?.error?.includes('Permission denied'))).toBe(false);
    // A lifecycle frame is not an API call, so the gate must not be consulted.
    expect(commands.checkExtensionPermission).not.toHaveBeenCalledWith(
      'org.asyar.demo',
      'asyar:extension:loaded',
    );

    framePostMessage.mockRestore();
  });

  it('lets asyar:stream:abort reach the stream dispatcher instead of denying it', async () => {
    const router = new ExtensionIpcRouter(
      {} as ServiceRegistry,
      getManifestById as any,
      vi.fn(),
      vi.fn(),
    );
    router.setup();

    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'asyar:stream:abort', payload: { streamId: 'stream-7' } },
        source: iframeEl.contentWindow,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(streamDispatcher.abort).toHaveBeenCalledWith('stream-7');
    expect(commands.checkExtensionPermission).not.toHaveBeenCalledWith(
      'org.asyar.demo',
      'asyar:stream:abort',
    );
  });

  it('reports a fail-closed denial by its reason, not as a missing manifest permission', async () => {
    // A call type is not a permission name, so "declare it in manifest.json" is
    // unfollowable advice for an unrecognized call — that is what a stale
    // extension bundle calling a DELETED api (e.g. the removed
    // snippets:setInlineFallbackEnabled) hits. Rust sends `reason` and no
    // `requiredPermission` in that case; surface it.
    vi.mocked(commands.checkExtensionPermission).mockResolvedValue({
      allowed: false,
      reason:
        'Call "asyar:api:snippets:setInlineFallbackEnabled" is not a recognized extension API — refusing by default (fail closed).',
    } as any);
    const framePostMessage = vi
      .spyOn(iframeEl.contentWindow as Window, 'postMessage')
      .mockImplementation(() => {});

    const router = new ExtensionIpcRouter(
      {} as ServiceRegistry,
      getManifestById as any,
      vi.fn(),
      vi.fn(),
    );
    router.setup();

    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: 'asyar:api:snippets:setInlineFallbackEnabled',
          payload: { enabled: true },
          messageId: 'gone-1',
        },
        source: iframeEl.contentWindow,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));

    const errors = framePostMessage.mock.calls
      .map((call) => call[0] as { messageId?: string; error?: string })
      .filter((msg) => msg?.messageId === 'gone-1' && msg?.error);

    expect(errors.length).toBeGreaterThan(0);
    expect(errors.every((msg) => !msg.error?.includes('manifest.json'))).toBe(true);
    expect(errors.some((msg) => msg.error?.includes('not a recognized extension API'))).toBe(true);
    // The reason already names the call, and the toast header shows it too —
    // don't echo it a second time.
    for (const msg of errors) {
      const mentions = msg.error?.split('asyar:api:snippets:setInlineFallbackEnabled').length ?? 1;
      expect(mentions - 1).toBeLessThanOrEqual(1);
    }

    framePostMessage.mockRestore();
  });

  it('still names the missing permission when one is genuinely undeclared', async () => {
    vi.mocked(commands.checkExtensionPermission).mockResolvedValue({
      allowed: false,
      requiredPermission: 'clipboard:read',
      reason: 'Extension "org.asyar.demo" has not declared "clipboard:read".',
    } as any);
    const framePostMessage = vi
      .spyOn(iframeEl.contentWindow as Window, 'postMessage')
      .mockImplementation(() => {});

    const router = new ExtensionIpcRouter(
      {} as ServiceRegistry,
      getManifestById as any,
      vi.fn(),
      vi.fn(),
    );
    router.setup();

    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'asyar:api:clipboard:readText', messageId: 'gated-2' },
        source: iframeEl.contentWindow,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));

    const errors = framePostMessage.mock.calls
      .map((call) => call[0] as { messageId?: string; error?: string })
      .filter((msg) => msg?.messageId === 'gated-2' && msg?.error);

    expect(
      errors.some(
        (msg) =>
          msg.error?.includes('clipboard:read') && msg.error?.includes('not declared in manifest'),
      ),
    ).toBe(true);

    framePostMessage.mockRestore();
  });

  it('still gates asyar:api:* calls from the same iframe', async () => {
    const storageGet = vi.fn(async () => 'value');
    const registry = { storage: { get: storageGet } } as unknown as ServiceRegistry;
    const router = new ExtensionIpcRouter(registry, getManifestById as any, vi.fn(), vi.fn());
    router.setup();

    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: 'asyar:api:storage:get',
          payload: { key: 'secret' },
          messageId: 'gated-1',
        },
        source: iframeEl.contentWindow,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(commands.checkExtensionPermission).toHaveBeenCalledWith(
      'org.asyar.demo',
      'asyar:api:storage:get',
    );
    expect(storageGet).not.toHaveBeenCalled();
  });
});
