import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NAMESPACES } from 'asyar-sdk/contracts';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

// Mock all service dependencies BEFORE importing the module under test
vi.mock('../log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), custom: vi.fn() },
}));
vi.mock('../settings/settingsService.svelte', () => ({
  settingsService: {
    getSettings: vi.fn().mockReturnValue({ search: {} }),
    updateSettings: vi.fn(),
    isExtensionEnabled: vi.fn().mockReturnValue(true),
  },
}));
vi.mock('../notification/notificationService', () => ({
  notificationService: {},
}));
vi.mock('../clipboard/clipboardHistoryService', () => ({
  clipboardHistoryService: {},
}));
vi.mock('./commandService.svelte', () => ({
  commandService: { commands: new Map(), registerCommand: vi.fn(), executeCommand: vi.fn() },
}));
vi.mock('../action/actionService.svelte', () => ({
  actionService: {},
}));
vi.mock('../statusBar/statusBarService.svelte', () => ({
  statusBarService: {},
}));
vi.mock('../search/searchBarAccessoryService.svelte', () => ({
  searchBarAccessoryService: {
    set: vi.fn(),
    clearForExtension: vi.fn(),
  },
}));
vi.mock('../auth/entitlementService.svelte', () => ({
  entitlementService: { check: vi.fn(), getAll: vi.fn() },
}));
vi.mock('../storage/extensionStorageService', () => ({
  extensionStorageService: {},
}));
vi.mock('./extensionPreferencesService.svelte', () => ({
  extensionPreferencesService: {
    getEffectivePreferences: vi.fn(),
    set: vi.fn(),
    reset: vi.fn(),
  },
}));
vi.mock('../storage/extensionCacheService', () => ({
  extensionCacheService: {},
}));
vi.mock('../feedback/feedbackService.svelte', () => ({
  feedbackService: {},
}));
vi.mock('../diagnostics/diagnosticsService.svelte', () => ({
  diagnosticsService: {},
}));
vi.mock('../selection/selectionService', () => ({
  selectionService: {},
}));
// aiService.svelte is deleted; no mock needed — the import is gone from buildServiceRegistry.
vi.mock('../oauth/extensionOAuthService.svelte', () => ({
  extensionOAuthService: {},
}));
vi.mock('../shell/shellService.svelte', () => ({
  shellService: {},
}));
vi.mock('../fileManager/fileManagerService', () => ({
  fileManagerService: {},
}));
vi.mock('../interop/interopService.svelte', () => ({
  InteropService: vi.fn().mockImplementation(function () {}),
}));
vi.mock('../application/applicationService', () => ({
  applicationService: {},
}));
vi.mock('../windowManagement/windowManagementService', () => ({
  windowManagementService: {},
}));
vi.mock('../opener/openerService', () => ({
  openerService: {},
}));
vi.mock('../network/networkService', () => ({
  networkService: {},
}));
vi.mock('../systemEvents/systemEventsService', () => ({
  systemEventsService: { subscribe: vi.fn(), unsubscribe: vi.fn() },
}));
vi.mock('../appEvents/appEventsService', () => ({
  appEventsService: { subscribe: vi.fn(), unsubscribe: vi.fn() },
}));
vi.mock('../power/powerService', () => ({
  powerService: { keepAwake: vi.fn(), release: vi.fn(), list: vi.fn() },
}));
vi.mock('../run/runService.svelte', () => ({
  runService: {},
}));

// Mock the IPC commands used by the real tools implementation (Item 7).
// These mocks must be defined BEFORE buildServiceRegistry is imported.
const mockAgentsToolsRegisterTier2 = vi.fn().mockResolvedValue(undefined);
const mockAgentsToolsList = vi.fn().mockResolvedValue([]);
vi.mock('../../lib/ipc/commands', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../lib/ipc/commands')>();
  return {
    ...original,
    agentsToolsRegisterTier2: (...args: unknown[]) => mockAgentsToolsRegisterTier2(...args),
    agentsToolsList: (...args: unknown[]) => mockAgentsToolsList(...args),
  };
});

import { buildServiceRegistry } from './buildServiceRegistry';

describe('buildServiceRegistry', () => {
  it('returns a registry with every NAMESPACES key present except the removed ai namespace', () => {
    const mockExtensionManager = {} as any;
    const mockGetManifestById = vi.fn();
    const mockHandleCommandAction = vi.fn();

    const registry = buildServiceRegistry({
      extensionManager: mockExtensionManager,
      getManifestById: mockGetManifestById,
      handleCommandAction: mockHandleCommandAction,
    });

    const registryKeys = Object.keys(registry);
    // Namespaces deliberately not wired into the JS-side registry.
    //
    // 'ai'       — IAIService was removed with the AI Chat feature.
    // 'snippets' — Shortcode contributions flow Tauri-direct via the
    //              snippets:registerShortcodes / unregisterShortcodes IPC
    //              topics handled by the launcher's extension IPC router,
    //              not through the JS service registry.
    const UNBOUND_NAMESPACES = new Set(['ai', 'snippets']);
    expect(registryKeys, `'ai' must NOT be in registry`).not.toContain('ai');
    expect(registryKeys, `'snippets' must NOT be in registry`).not.toContain('snippets');
    for (const ns of NAMESPACES) {
      if (UNBOUND_NAMESPACES.has(ns)) continue;
      expect(registryKeys, `Missing namespace: ${ns}`).toContain(ns);
    }
    expect(registryKeys.length).toBe(NAMESPACES.length - UNBOUND_NAMESPACES.size);
  });

  it('uses the provided extensionManager as the "extensions" entry', () => {
    const mockExtensionManager = { id: 'mock-em' } as any;

    const registry = buildServiceRegistry({
      extensionManager: mockExtensionManager,
      getManifestById: vi.fn(),
      handleCommandAction: vi.fn(),
    });

    expect(registry.extensions).toBe(mockExtensionManager);
  });
});

describe('buildServiceRegistry search entry', () => {
  it('search.rank delegates to the rank_items Tauri command with a named-key payload', async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    vi.mocked(invoke).mockResolvedValueOnce(['b']);

    const registry = makeRegistry() as any;
    const items = [{ id: 'a', title: 'Apple' }, { id: 'b', title: 'Banana' }];
    const result = await registry.search.rank('ban', items);

    expect(invoke).toHaveBeenCalledWith('rank_items', { query: 'ban', items });
    expect(result).toEqual(['b']);
  });
});

// ── Item 7: tools service entry in registry ───────────────────────────────────

function makeRegistry() {
  return buildServiceRegistry({
    extensionManager: {} as any,
    getManifestById: vi.fn(),
    handleCommandAction: vi.fn(),
  });
}

const sampleTool = {
  id: 'a',
  name: 'Tool A',
  description: 'Does A',
  parameters: { type: 'object', properties: {} },
};

describe('buildServiceRegistry tools entry — Item 7', () => {
  beforeEach(() => {
    mockAgentsToolsRegisterTier2.mockClear();
    mockAgentsToolsList.mockClear();
  });

  it('tools.registerTool calls agentsToolsRegisterTier2 with the current tool set', async () => {
    const registry = makeRegistry();

    await registry.tools.registerTool('ext.foo', sampleTool);

    expect(mockAgentsToolsRegisterTier2).toHaveBeenCalledWith(
      'ext.foo',
      expect.arrayContaining([expect.objectContaining({ id: 'a' })]),
    );
  });

  it('tools.registerTool accumulates tools per extension across calls', async () => {
    const registry = makeRegistry();
    const toolB = { id: 'b', name: 'Tool B', description: 'Does B', parameters: {} };

    await registry.tools.registerTool('ext.foo', sampleTool);
    await registry.tools.registerTool('ext.foo', toolB);

    // Second call must pass both tools.
    const lastCall = mockAgentsToolsRegisterTier2.mock.calls.at(-1);
    expect(lastCall).toBeDefined();
    expect(lastCall![0]).toBe('ext.foo');
    const toolIds = (lastCall![1] as { id: string }[]).map((t) => t.id);
    expect(toolIds).toContain('a');
    expect(toolIds).toContain('b');
  });

  it('tools.unregisterTool removes only the specified tool from the set', async () => {
    const registry = makeRegistry();
    const toolB = { id: 'b', name: 'Tool B', description: 'Does B', parameters: {} };

    await registry.tools.registerTool('ext.foo', sampleTool);
    await registry.tools.registerTool('ext.foo', toolB);
    mockAgentsToolsRegisterTier2.mockClear();

    await registry.tools.unregisterTool('ext.foo', 'a');

    expect(mockAgentsToolsRegisterTier2).toHaveBeenCalled();
    const lastCall = mockAgentsToolsRegisterTier2.mock.calls.at(-1);
    const toolIds = (lastCall![1] as { id: string }[]).map((t) => t.id);
    expect(toolIds).not.toContain('a');
    expect(toolIds).toContain('b');
  });

  it('tools.listTools forwards to agentsToolsList and returns the result', async () => {
    const descriptor = {
      id: 'echo',
      name: 'Echo',
      description: 'Echoes',
      parameters: {},
      source: { kind: 'builtin' },
      fullyQualifiedId: 'builtin:echo',
    };
    mockAgentsToolsList.mockResolvedValueOnce([descriptor]);

    const registry = makeRegistry();
    const result = await registry.tools.listTools();

    expect(mockAgentsToolsList).toHaveBeenCalled();
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('echo');
  });
});

// ── CI guard: keep INJECTS_EXTENSION_ID / ALWAYS_INJECTS_CALLER_ID in sync ──
//
// The dispatcher in ExtensionIpcRouter prepends `extensionId` (or caller id)
// to a handler's args ONLY when the namespace is in the matching set.
// Forgetting to add a new namespace produces the silent bug the router's
// own docblock warns about. This test walks every handler in the registry
// and asserts: if first parameter is named `extensionId`, the namespace
// must be in INJECTS_EXTENSION_ID (analogous for `caller`).

import { INJECTS_EXTENSION_ID, ALWAYS_INJECTS_CALLER_ID } from './ExtensionIpcRouter';

function* enumerateMethods(svc: unknown): Generator<[string, Function]> {
  if (svc === null || typeof svc !== 'object') return;
  const seen = new Set<string>();
  for (const [k, v] of Object.entries(svc)) {
    if (typeof v === 'function' && !seen.has(k)) {
      seen.add(k);
      yield [k, v];
    }
  }
  let proto = Object.getPrototypeOf(svc);
  while (proto && proto !== Object.prototype) {
    for (const k of Object.getOwnPropertyNames(proto)) {
      if (k === 'constructor' || seen.has(k)) continue;
      const v = (svc as Record<string, unknown>)[k];
      if (typeof v === 'function') {
        seen.add(k);
        yield [k, v as Function];
      }
    }
    proto = Object.getPrototypeOf(proto);
  }
}

function firstParamName(fn: Function): string | null {
  const src = fn.toString();
  const noComments = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const m =
    /(?:async\s+)?(?:function\s*\*?\s*[\w$]*\s*)?\(\s*\{?\s*([\w$]+)/.exec(noComments) ??
    /^\s*(?:async\s+)?([\w$]+)\s*=>/.exec(noComments);
  return m?.[1] ?? null;
}

// Param names that signal the handler expects the dispatcher to inject the
// caller's identity as the first argument. `extensionId` is the strict shape
// (only injected for iframe callers); `caller` / `callerExtensionId` is the
// nullable shape (always injected, `null` for privileged host context).
const CALLER_PARAM_NAMES = new Set(['extensionId', 'caller', 'callerExtensionId']);

describe('buildServiceRegistry — INJECTS_EXTENSION_ID drift guard', () => {
  it('every handler whose first parameter signals caller-injection is in INJECTS_EXTENSION_ID or ALWAYS_INJECTS_CALLER_ID', () => {
    const registry = makeRegistry();
    const offenders: string[] = [];
    let extractedAny = false;

    for (const ns of NAMESPACES) {
      const svc = (registry as unknown as Record<string, unknown>)[ns];
      for (const [method, fn] of enumerateMethods(svc)) {
        const param = firstParamName(fn);
        if (param) extractedAny = true;
        if (
          param &&
          CALLER_PARAM_NAMES.has(param) &&
          !INJECTS_EXTENSION_ID.has(ns) &&
          !ALWAYS_INJECTS_CALLER_ID.has(ns)
        ) {
          offenders.push(`${ns}.${method} (param: ${param})`);
        }
      }
    }

    // Sentinel: if we extracted nothing, the toString source has been
    // minified or transformed and this guard has silently weakened.
    expect(extractedAny, 'guard could not extract parameter names from any handler — has the build pipeline started minifying tests? Revisit firstParamName.').toBe(true);

    expect(
      offenders,
      `Handler signatures imply caller-injection but their namespace is not in INJECTS_EXTENSION_ID ` +
        `or ALWAYS_INJECTS_CALLER_ID — the dispatcher will silently feed the IPC payload into the ` +
        `id slot. Add to one of the sets in ExtensionIpcRouter.ts: ${offenders.join(', ')}`,
    ).toEqual([]);
  });
});
