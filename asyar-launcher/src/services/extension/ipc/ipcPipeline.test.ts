/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

vi.mock('../../log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../extensionIframeManager.svelte', () => ({
  extensionIframeManager: { handleSearchResponse: vi.fn() },
}));
vi.mock('../extensionPreferencesService.svelte', () => ({
  extensionPreferencesService: { getEffectivePreferences: vi.fn() },
}));
vi.mock('../streamDispatcher.svelte', () => ({ streamDispatcher: { abort: vi.fn() } }));
vi.mock('../../../lib/ipc/commands', () => ({
  checkExtensionPermission: vi.fn(),
  hideWindow: vi.fn(),
}));
vi.mock('../../feedback/feedbackService.svelte', () => ({ feedbackService: { report: vi.fn() } }));
vi.mock('../../dev/inspectorStore.svelte', () => ({
  inspectorStore: { recordRpcLog: vi.fn(), recordIpcLog: vi.fn() },
}));
vi.mock('./devTracing', () => ({ isDevInspectorActive: vi.fn(() => true) }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

import * as commands from '../../../lib/ipc/commands';
import { logService } from '../../log/logService';
import { extensionIframeManager } from '../extensionIframeManager.svelte';
import { extensionPreferencesService } from '../extensionPreferencesService.svelte';
import { streamDispatcher } from '../streamDispatcher.svelte';
import { feedbackService } from '../../feedback/feedbackService.svelte';
import { inspectorStore } from '../../dev/inspectorStore.svelte';
import { isDevInspectorActive } from './devTracing';
import { ExtensionIpcRouter } from '../ExtensionIpcRouter';
import { permissionConsentService } from '../permissionConsentService.svelte';
import { HandledDispatchError } from './errors';
import { IPC_HANDLERS } from './handlers';
import { IPC_PIPELINE } from './pipeline';
import type { ServiceRegistry } from '../defineServiceRegistry';

const EXT_ID = 'org.asyar.demo';

let viewFrame: HTMLIFrameElement;
let workerFrame: HTMLIFrameElement;
let strangerFrame: HTMLIFrameElement;
let viewPost: ReturnType<typeof vi.fn>;
let workerPost: ReturnType<typeof vi.fn>;
let strangerPost: ReturnType<typeof vi.fn>;
let goBack: Mock<() => void>;
let saveSearchIndex: Mock<() => void>;
let storageGet: ReturnType<typeof vi.fn>;

function mountFrame(role: string, extensionId?: string): HTMLIFrameElement {
  const frame = document.createElement('iframe');
  if (extensionId) frame.setAttribute('data-extension-id', extensionId);
  frame.setAttribute('data-role', role);
  document.body.appendChild(frame);
  return frame;
}

/** Replies land on `event.source`, so each frame gets its own postMessage spy. */
function spyPost(frame: HTMLIFrameElement): ReturnType<typeof vi.fn> {
  const spy = vi.fn();
  Object.defineProperty(frame.contentWindow as Window, 'postMessage', {
    value: spy,
    configurable: true,
    writable: true,
  });
  return spy;
}

function makeRouter(registry: Record<string, unknown> = {}): ExtensionIpcRouter {
  return new ExtensionIpcRouter(
    registry as unknown as ServiceRegistry,
    (id: string) => (id === EXT_ID ? ({ id } as never) : undefined),
    goBack,
    saveSearchIndex,
  );
}

function frameEvent(
  data: Record<string, unknown>,
  source: Window | null = viewFrame.contentWindow,
): MessageEvent {
  return new MessageEvent('message', { data, source });
}

function responsesTo(spy: ReturnType<typeof vi.fn>): Array<Record<string, unknown>> {
  return spy.mock.calls
    .map((call) => call[0] as Record<string, unknown>)
    .filter((msg) => msg?.type === 'asyar:response');
}

beforeEach(() => {
  vi.clearAllMocks();
  document.querySelectorAll('iframe').forEach((el) => el.remove());
  viewFrame = mountFrame('view', EXT_ID);
  workerFrame = mountFrame('worker', EXT_ID);
  strangerFrame = mountFrame('view');
  viewPost = spyPost(viewFrame);
  workerPost = spyPost(workerFrame);
  strangerPost = spyPost(strangerFrame);
  goBack = vi.fn<() => void>();
  saveSearchIndex = vi.fn<() => void>();
  storageGet = vi.fn(async () => 'stored-value');
  vi.mocked(isDevInspectorActive).mockReturnValue(true);
  vi.mocked(commands.checkExtensionPermission).mockResolvedValue({ allowed: true } as never);
  vi.mocked(extensionPreferencesService.getEffectivePreferences).mockResolvedValue({
    extension: {},
    commands: {},
  } as never);
  permissionConsentService.reset();
});

// ── §3 behavior matrix ──────────────────────────────────────────────────────
// Every row is current behavior. The columns are the four cross-cutting
// concerns the old if-cascade applied by position; here they are asserted
// per message type so "stage applied to the wrong set of types" fails loudly.

type MatrixRow = {
  label: string;
  data: Record<string, unknown>;
  gate: boolean;
  reply: boolean;
};

const MATRIX: MatrixRow[] = [
  { label: 'non-asyar frame', data: { type: 'webpack:hmr' }, gate: false, reply: false },
  { label: 'asyar:window:hide', data: { type: 'asyar:window:hide' }, gate: false, reply: false },
  {
    label: 'asyar:response',
    data: { type: 'asyar:response', messageId: 'm-response', result: 1 },
    gate: false,
    reply: false,
  },
  {
    label: 'externally consumed tool response',
    data: { type: 'asyar:tools:invoke:response', messageId: 'm-tool' },
    gate: false,
    reply: false,
  },
  {
    label: 'asyar:dev:rpc-log (dev + tracing on)',
    data: { type: 'asyar:dev:rpc-log', payload: { extensionId: EXT_ID } },
    gate: false,
    reply: false,
  },
  {
    label: 'asyar:dev:ipc-log (dev + tracing on)',
    data: { type: 'asyar:dev:ipc-log', payload: { extensionId: EXT_ID } },
    gate: false,
    reply: false,
  },
  {
    label: 'asyar:feedback:uncaught',
    data: { type: 'asyar:feedback:uncaught', payload: { kind: 'iframe_uncaught' } },
    gate: false,
    reply: false,
  },
  {
    label: 'asyar:stream:abort',
    data: { type: 'asyar:stream:abort', payload: { streamId: 'stream-1' } },
    gate: false,
    reply: false,
  },
  {
    label: 'asyar:extension:loaded',
    data: { type: 'asyar:extension:loaded' },
    gate: false,
    reply: false,
  },
  {
    label: 'asyar:api:* call',
    data: { type: 'asyar:api:storage:get', payload: { key: 'k' }, messageId: 'm-api' },
    gate: true,
    reply: true,
  },
  {
    label: 'unknown asyar:* frame',
    data: { type: 'asyar:mystery:frame', messageId: 'm-unknown' },
    gate: false,
    reply: true,
  },
];

describe('IPC pipeline — §3 behavior matrix', () => {
  it.each(MATRIX)('$label taps the search-response bridge', async (row) => {
    await makeRouter({ storage: { get: storageGet } }).handleMessage(frameEvent(row.data));

    expect(extensionIframeManager.handleSearchResponse).toHaveBeenCalledTimes(1);
  });

  it.each(MATRIX)('$label runs the Rust permission gate: $gate', async (row) => {
    await makeRouter({ storage: { get: storageGet } }).handleMessage(frameEvent(row.data));

    if (row.gate) {
      expect(commands.checkExtensionPermission).toHaveBeenCalledWith(EXT_ID, row.data.type);
    } else {
      expect(commands.checkExtensionPermission).not.toHaveBeenCalled();
    }
  });

  it.each(MATRIX)('$label posts an asyar:response envelope: $reply', async (row) => {
    await makeRouter({ storage: { get: storageGet } }).handleMessage(frameEvent(row.data));

    expect(responsesTo(viewPost).length > 0).toBe(row.reply);
  });

  it('replies to an unknown asyar:* frame with an undefined result and warns in DEV', async () => {
    await makeRouter().handleMessage(frameEvent({ type: 'asyar:x:y', messageId: 'm-x' }));

    expect(responsesTo(viewPost)).toEqual([
      { type: 'asyar:response', messageId: 'm-x', result: undefined },
    ]);
    expect(logService.warn).toHaveBeenCalledWith('[IPC] Unhandled message type: asyar:x:y');
  });

  it('answers asyar:extension:loaded with the preferences bundle, not a response envelope', async () => {
    vi.mocked(extensionPreferencesService.getEffectivePreferences).mockResolvedValue({
      extension: { theme: 'dark' },
      commands: {},
    } as never);

    await makeRouter().handleMessage(frameEvent({ type: 'asyar:extension:loaded' }));

    expect(viewPost).toHaveBeenCalledWith(
      {
        type: 'asyar:event:preferences:set-all',
        payload: { extension: { theme: 'dark' }, commands: {} },
      },
      '*',
    );
  });

  it('routes asyar:stream:abort to the stream dispatcher', async () => {
    await makeRouter().handleMessage(
      frameEvent({ type: 'asyar:stream:abort', payload: { streamId: 'stream-1' } }),
    );

    expect(streamDispatcher.abort).toHaveBeenCalledWith('stream-1');
  });

  it('hides the launcher for asyar:window:hide', async () => {
    await makeRouter().handleMessage(frameEvent({ type: 'asyar:window:hide' }));

    expect(goBack).toHaveBeenCalled();
    expect(saveSearchIndex).toHaveBeenCalled();
    expect(commands.hideWindow).toHaveBeenCalled();
  });

  it('records dev-inspector logs when dev mode and tracing are both on', async () => {
    await makeRouter().handleMessage(
      frameEvent({ type: 'asyar:dev:rpc-log', payload: { extensionId: EXT_ID, step: 1 } }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(inspectorStore.recordRpcLog).toHaveBeenCalledWith(EXT_ID, {
      extensionId: EXT_ID,
      step: 1,
    });
  });
});

// ── stage order is data, not control flow ───────────────────────────────────

describe('IPC pipeline — declared order', () => {
  it('exports the stage order explicitly', () => {
    expect(IPC_PIPELINE.map((stage) => stage.name)).toEqual([
      'tap',
      'protocolFilter',
      'preIdentityHandlers',
      'identify',
      'permissionGate',
      'replyEnvelope',
      'dispatch',
    ]);
  });

  it('runs the permission gate after identity is established', () => {
    const names = IPC_PIPELINE.map((stage) => stage.name);

    expect(names.indexOf('identify')).toBeLessThan(names.indexOf('permissionGate'));
    expect(names.indexOf('permissionGate')).toBeLessThan(names.indexOf('dispatch'));
  });

  it('declares ungated transport frames as pre-identity handlers', () => {
    for (const type of [
      'asyar:window:hide',
      'asyar:feedback:uncaught',
      'asyar:dev:rpc-log',
      'asyar:dev:ipc-log',
    ]) {
      expect(IPC_HANDLERS[type]?.beforeIdentity).toBe(true);
    }
  });

  it('declares identity-bearing lifecycle frames as post-identity handlers', () => {
    for (const type of ['asyar:stream:abort', 'asyar:extension:loaded']) {
      expect(IPC_HANDLERS[type]?.beforeIdentity).toBeFalsy();
    }
  });
});

// ── the wave-3 bug class: a stage applied to the wrong set of types ─────────

describe('IPC pipeline — ungated frames never reach the permission gate', () => {
  const UNGATED = [
    { label: 'asyar:window:hide', data: { type: 'asyar:window:hide' } },
    {
      label: 'asyar:feedback:uncaught',
      data: { type: 'asyar:feedback:uncaught', payload: { kind: 'iframe_uncaught' } },
    },
    {
      label: 'asyar:dev:rpc-log',
      data: { type: 'asyar:dev:rpc-log', payload: { extensionId: EXT_ID } },
    },
    {
      label: 'asyar:dev:ipc-log',
      data: { type: 'asyar:dev:ipc-log', payload: { extensionId: EXT_ID } },
    },
    { label: 'asyar:extension:loaded', data: { type: 'asyar:extension:loaded' } },
    {
      label: 'asyar:stream:abort',
      data: { type: 'asyar:stream:abort', payload: { streamId: 's-1' } },
    },
  ];

  it.each(UNGATED)('$label never invokes checkExtensionPermission', async (row) => {
    // Gate denies everything — exactly what fail-closed Rust does for a type
    // it does not classify. A frame that consults it at all breaks here.
    vi.mocked(commands.checkExtensionPermission).mockResolvedValue({
      allowed: false,
      reason: 'not a recognized extension API',
    } as never);

    await makeRouter().handleMessage(frameEvent(row.data));

    expect(commands.checkExtensionPermission).not.toHaveBeenCalled();
  });
});

// ── identity ────────────────────────────────────────────────────────────────

describe('IPC pipeline — caller identity', () => {
  const IDENTITY_REQUIRED = [
    {
      label: 'asyar:stream:abort',
      data: { type: 'asyar:stream:abort', payload: { streamId: 's-2' } },
      assertNoEffect: () => expect(streamDispatcher.abort).not.toHaveBeenCalled(),
    },
    {
      label: 'asyar:extension:loaded',
      data: { type: 'asyar:extension:loaded' },
      assertNoEffect: () =>
        expect(extensionPreferencesService.getEffectivePreferences).not.toHaveBeenCalled(),
    },
    {
      label: 'asyar:api:storage:get',
      data: { type: 'asyar:api:storage:get', payload: { key: 'k' }, messageId: 'm-1' },
      assertNoEffect: () => expect(storageGet).not.toHaveBeenCalled(),
    },
    {
      label: 'unknown asyar:* frame',
      data: { type: 'asyar:mystery:frame', messageId: 'm-2' },
      assertNoEffect: () => undefined,
    },
  ];

  it.each(IDENTITY_REQUIRED)('$label is dropped from an unidentified frame', async (row) => {
    await makeRouter({ storage: { get: storageGet } }).handleMessage(
      frameEvent(row.data, strangerFrame.contentWindow),
    );

    expect(strangerPost).not.toHaveBeenCalled();
    expect(commands.checkExtensionPermission).not.toHaveBeenCalled();
    row.assertNoEffect();
  });

  it('still hides the launcher for an unidentified frame — window:hide is self-scoped', async () => {
    await makeRouter().handleMessage(
      frameEvent({ type: 'asyar:window:hide' }, strangerFrame.contentWindow),
    );

    expect(commands.hideWindow).toHaveBeenCalled();
  });

  it('drops asyar:feedback:uncaught from an unidentified frame without replying', async () => {
    await makeRouter().handleMessage(
      frameEvent(
        { type: 'asyar:feedback:uncaught', payload: { kind: 'iframe_uncaught' } },
        strangerFrame.contentWindow,
      ),
    );

    expect(feedbackService.report).not.toHaveBeenCalled();
    expect(strangerPost).not.toHaveBeenCalled();
  });

  it('stamps the DOM-derived id and role on a reported extension fault', async () => {
    await makeRouter().handleMessage(
      frameEvent(
        {
          type: 'asyar:feedback:uncaught',
          extensionId: 'org.asyar.malicious',
          payload: { kind: 'iframe_unhandled_rejection', developerDetail: 'boom' },
        },
        workerFrame.contentWindow,
      ),
    );

    expect(feedbackService.report).toHaveBeenCalledWith(
      expect.objectContaining({
        extensionId: EXT_ID,
        kind: 'iframe_unhandled_rejection',
        context: { extensionId: EXT_ID, role: 'worker' },
      }),
    );
  });

  it('rejects a frame whose host-set id has no registered manifest', async () => {
    const orphan = mountFrame('view', 'org.asyar.orphan');
    const orphanPost = spyPost(orphan);

    await makeRouter().handleMessage(
      frameEvent(
        { type: 'asyar:api:storage:get', payload: { key: 'k' }, messageId: 'm-orphan' },
        orphan.contentWindow,
      ),
    );

    expect(responsesTo(orphanPost)).toEqual([
      {
        type: 'asyar:response',
        messageId: 'm-orphan',
        error: 'Unknown extension: org.asyar.orphan',
      },
    ]);
    expect(commands.checkExtensionPermission).not.toHaveBeenCalled();
  });
});

// ── trust boundary ──────────────────────────────────────────────────────────

describe('IPC pipeline — trust boundary', () => {
  it('ignores a payload-supplied extensionId from a non-privileged frame', async () => {
    await makeRouter({ storage: { get: storageGet } }).handleMessage(
      frameEvent({
        type: 'asyar:api:storage:get',
        extensionId: 'org.asyar.malicious',
        payload: { extensionId: 'org.asyar.malicious', key: 'secret' },
        messageId: 'm-spoof',
      }),
    );

    expect(commands.checkExtensionPermission).toHaveBeenCalledWith(EXT_ID, 'asyar:api:storage:get');
    expect(storageGet).toHaveBeenCalledWith(EXT_ID, 'org.asyar.malicious', 'secret');
  });

  it('reads the payload-supplied extensionId only for the privileged host context', async () => {
    await makeRouter({ storage: { get: storageGet } }).handleMessage(
      new MessageEvent('message', {
        data: {
          type: 'asyar:api:storage:get',
          extensionId: 'org.asyar.builtin',
          payload: { key: 'k' },
          messageId: 'm-host',
        },
        source: window,
      }),
    );

    expect(commands.checkExtensionPermission).not.toHaveBeenCalled();
    expect(storageGet).toHaveBeenCalledWith('org.asyar.builtin', 'k');
  });

  it('replies to the frame that asked, never to the extension’s other iframe', async () => {
    await makeRouter({ storage: { get: storageGet } }).handleMessage(
      frameEvent(
        { type: 'asyar:api:storage:get', payload: { key: 'k' }, messageId: 'm-worker' },
        workerFrame.contentWindow,
      ),
    );

    expect(responsesTo(workerPost)).toEqual([
      { type: 'asyar:response', messageId: 'm-worker', result: 'stored-value' },
    ]);
    expect(viewPost).not.toHaveBeenCalled();
  });

  it('stamps the action-handler role from the iframe attribute, then still replies', async () => {
    const recordActionHandlerRole = vi.fn();
    const router = makeRouter({ actions: { recordActionHandlerRole } });

    await router.handleMessage(
      frameEvent(
        {
          type: 'asyar:api:actions:registerActionHandler',
          payload: { actionId: 'act_1', role: 'view' },
          messageId: 'm-role',
        },
        workerFrame.contentWindow,
      ),
    );

    expect(recordActionHandlerRole).toHaveBeenCalledWith(EXT_ID, 'act_1', 'worker');
    expect(responsesTo(workerPost)).toEqual([
      { type: 'asyar:response', messageId: 'm-role', result: undefined },
    ]);
  });
});

// ── permission denial + error envelopes ─────────────────────────────────────

describe('IPC pipeline — denial and error envelopes', () => {
  it('names the missing manifest permission when Rust supplies one', async () => {
    vi.mocked(commands.checkExtensionPermission).mockResolvedValue({
      allowed: false,
      requiredPermission: 'clipboard:read',
      reason: 'not declared',
    } as never);

    await makeRouter().handleMessage(
      frameEvent({ type: 'asyar:api:clipboard:readText', messageId: 'm-denied' }),
    );

    expect(responsesTo(viewPost)).toEqual([
      {
        type: 'asyar:response',
        messageId: 'm-denied',
        error: 'Permission denied: "clipboard:read" is required but not declared in manifest.json',
        errorCode: 'PERMISSION_DENIED',
        errorDetails: { permission: 'clipboard:read' },
      },
    ]);
    expect(feedbackService.report).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'permission_denied' }),
    );
  });

  it('attaches PERMISSION_CONSENT_REQUIRED when manifest declared permission but consent is pending', async () => {
    vi.mocked(commands.checkExtensionPermission).mockResolvedValue({
      allowed: false,
      requiredPermission: 'fs:watch',
      reason: 'needs consent',
    } as never);

    const router = new ExtensionIpcRouter(
      {} as ServiceRegistry,
      (id: string) => (id === EXT_ID ? ({ id, permissions: ['fs:watch'] } as never) : undefined),
      goBack,
      saveSearchIndex,
    );

    await router.handleMessage(
      frameEvent({ type: 'asyar:api:fsWatcher:create', messageId: 'm-consent' }),
    );

    expect(responsesTo(viewPost)).toEqual([
      {
        type: 'asyar:response',
        messageId: 'm-consent',
        error: 'Permission consent required: "fs:watch" requires user review in Settings',
        errorCode: 'PERMISSION_CONSENT_REQUIRED',
        errorDetails: { permission: 'fs:watch' },
      },
    ]);
    expect(feedbackService.report).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'permission_denied' }),
    );
  });

  it('surfaces a fail-closed reason verbatim when no permission is named', async () => {
    vi.mocked(commands.checkExtensionPermission).mockResolvedValue({
      allowed: false,
      reason: 'Call "asyar:api:gone:method" is not a recognized extension API.',
    } as never);

    await makeRouter().handleMessage(
      frameEvent({ type: 'asyar:api:gone:method', messageId: 'm-gone' }),
    );

    expect(responsesTo(viewPost)[0]?.error).toBe(
      'Call "asyar:api:gone:method" is not a recognized extension API.',
    );
  });

  it('reports a diagnostic for an unhandled dispatch error', async () => {
    const get = vi.fn(async () => {
      throw new Error('boom');
    });

    await makeRouter({ storage: { get } }).handleMessage(
      frameEvent({ type: 'asyar:api:storage:get', payload: { key: 'k' }, messageId: 'm-boom' }),
    );

    expect(responsesTo(viewPost)).toEqual([
      { type: 'asyar:response', messageId: 'm-boom', error: 'boom' },
    ]);
    expect(feedbackService.report).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'extension_proxy_error' }),
    );
  });

  it('suppresses the second diagnostic for an already-reported HandledDispatchError', async () => {
    const get = vi.fn(async () => {
      throw new HandledDispatchError('already reported');
    });

    await makeRouter({ storage: { get } }).handleMessage(
      frameEvent({ type: 'asyar:api:storage:get', payload: { key: 'k' }, messageId: 'm-handled' }),
    );

    expect(responsesTo(viewPost)).toEqual([
      { type: 'asyar:response', messageId: 'm-handled', error: 'already reported' },
    ]);
    expect(feedbackService.report).not.toHaveBeenCalled();
  });

  it('surfaces developerDetail for an AppError-shaped rejection', async () => {
    const glob = vi.fn(async () => {
      throw {
        source: 'rust',
        kind: 'validation_failure',
        severity: 'warning',
        retryable: false,
        context: {},
        developerDetail: 'files:glob pattern must begin with an absolute literal prefix',
      };
    });

    await makeRouter({ files: { glob } }).handleMessage(
      frameEvent({
        type: 'asyar:api:files:glob',
        payload: { pattern: 'bad' },
        messageId: 'm-glob',
      }),
    );

    expect(responsesTo(viewPost)[0]?.error).toBe(
      'files:glob pattern must begin with an absolute literal prefix',
    );
  });
});

// ── §3 edge case 1 — dev logs with tracing off ──────────────────────────────

describe('IPC pipeline — dev logs when dev inspection is off', () => {
  it('falls through to the unknown-frame bucket and gets a reply envelope', async () => {
    vi.mocked(isDevInspectorActive).mockReturnValue(false);

    await makeRouter().handleMessage(
      frameEvent({
        type: 'asyar:dev:ipc-log',
        payload: { extensionId: EXT_ID },
        messageId: 'm-dev',
      }),
    );

    expect(inspectorStore.recordIpcLog).not.toHaveBeenCalled();
    expect(responsesTo(viewPost)).toEqual([
      { type: 'asyar:response', messageId: 'm-dev', result: undefined },
    ]);
  });
});
