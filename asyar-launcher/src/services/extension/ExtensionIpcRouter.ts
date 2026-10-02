import { logService } from '../log/logService';
import * as commands from '../../lib/ipc/commands';
import { contributeShortcodes, revokeShortcodes } from '../../lib/ipc/shortcodeCommands';
import { messageBroker, type Namespace } from 'asyar-sdk/contracts';
import type { ServiceRegistry } from './defineServiceRegistry';
import type { ExtendedManifest } from '../../types/ExtendedManifest';
import { HandledDispatchError } from './ipc/errors';
import { runIpcPipeline } from './ipc/pipeline';
import type { IframeRole, IpcContext, IpcDeps } from './ipc/types';
import { workerHost } from './workerHost.svelte';

const EXTENSION_INVOKE_DISPATCH: Record<string, (args: any) => Promise<any>> = {
  search_items: (args) => commands.searchItems(args?.query ?? ''),
  check_path_exists: (args) => commands.checkPathExists(args?.path ?? ''),
  list_applications: () => commands.listApplications(),
  get_extensions_dir: () => commands.getExtensionsDir(),
  list_installed_extensions: () => commands.listInstalledExtensions(),
  get_builtin_extensions_path: () => commands.getBuiltinFeaturesPath(),
  get_indexed_object_ids: () => commands.getIndexedObjectIds(),
  get_autostart_status: () => commands.getAutostartStatus(),
  get_persisted_shortcut: () => commands.getPersistedShortcut(),
  check_snippet_permission: () => commands.checkSnippetPermission(),
};

// Kept for documentation — actual dispatch uses EXTENSION_INVOKE_DISPATCH
export const ALLOWED_EXTENSION_INVOKE_COMMANDS = new Set(Object.keys(EXTENSION_INVOKE_DISPATCH));

/**
 * Services whose first parameter is the calling extension's ID.
 * Only injected when `extensionId` is present (i.e., from an iframe context).
 * Example: `storage.get(extensionId, key)` — the extension never passes its own ID.
 *
 * If you add a new service that needs per-extension scoping, add its canonical
 * namespace here. Missing it means the service receives the raw IPC payload as
 * its first argument instead of the extension ID — a silent, hard-to-debug bug.
 */
export const INJECTS_EXTENSION_ID = new Set<Namespace>([
  'storage',
  'oauth',
  'shell',
  'interop',
  'cache',
  'preferences',
  'power',
  'screen',
  'process',
  'systemEvents',
  'appEvents',
  'timers',
  'fsWatcher',
  'state',
  'searchBar',
  'feedback',
  'onboarding',
  'runs',
  'tools',
  'environment',
  'ai',
  'mcp',
] as const satisfies readonly Namespace[]);

/**
 * Services that ALWAYS receive the caller identity as the first argument —
 * even `null` for privileged host-context calls. Used for audit logging where
 * the service needs to know who triggered the request regardless of context.
 */
export const ALWAYS_INJECTS_CALLER_ID = new Set<Namespace>([
  'network',
  'applicationIndex',
  'files',
  'opener',
  'browser',
] as const satisfies readonly Namespace[]);

/**
 * Declarative parameter order schemas for RPC methods invoked with object payloads.
 * Maps `namespace:method` to the exact positional parameter order expected by
 * the underlying service method (excluding injected extensionId/callerId or trailing originRole).
 *
 * Prevents argument swapping bugs caused by unstable JavaScript object key iteration order.
 */
export const METHOD_PARAM_SCHEMAS: Record<string, string[]> = {
  // notes
  'notes:search': ['query', 'limit'],
  'notes:list': ['limit'],
  'notes:get': ['idOrTitle'],
  'notes:create': ['title', 'body'],
  'notes:append': ['idOrTitle', 'text'],

  // ai
  'ai:complete': ['prompt', 'options'],
  'ai:streamChat': ['prompt', 'streamId', 'options'],

  // mcp
  'mcp:listServers': [],
  'mcp:listTools': ['serverId'],
  'mcp:invokeTool': ['serverId', 'toolId', 'args'],

  // clipboard
  'clipboard:initialize': [],
  'clipboard:subscribeCapture': ['callerId'],
  'clipboard:unsubscribeCapture': ['callerId'],
  'clipboard:pasteItem': ['item'],
  'clipboard:hideWindow': [],
  'clipboard:simulatePaste': [],
  'clipboard:writeToClipboard': ['item'],
  'clipboard:getRecentItems': ['limit'],
  'clipboard:searchHistory': ['query'],
  'clipboard:toggleItemFavorite': ['itemId'],
  'clipboard:deleteItem': ['itemId'],
  'clipboard:clearNonFavorites': [],
  'clipboard:readCurrentText': [],
  'clipboard:stripHtml': ['html'],
  'clipboard:stripRtf': ['rtf'],

  // storage
  'storage:get': ['key'],
  'storage:set': ['key', 'value'],
  'storage:delete': ['key'],
  'storage:getAll': [],
  'storage:clear': [],

  // cache
  'cache:get': ['key'],
  'cache:set': ['key', 'value', 'expiresAt'],
  'cache:delete': ['key'],
  'cache:clear': [],

  // preferences
  'preferences:getAll': [],
  'preferences:set': ['scope', 'key', 'value'],
  'preferences:reset': ['scope'],

  // oauth
  'oauth:authorize': ['providerId', 'clientId', 'authorizationUrl', 'tokenUrl', 'scopes', 'flowId'],
  'oauth:revokeToken': ['providerId'],

  // shell
  'shell:spawn': ['program', 'args', 'spawnId', 'stdin'],
  'shell:list': [],
  'shell:attach': ['spawnId'],
  'shell:writeStdin': ['spawnId', 'data'],
  'shell:closeStdin': ['spawnId'],
  'shell:write-stdin': ['spawnId', 'data'],
  'shell:close-stdin': ['spawnId'],

  // interop
  'interop:launchCommand': ['extensionId', 'commandId', 'args'],

  // power
  'power:keepAwake': ['options'],
  'power:release': ['token'],
  'power:list': [],

  // screen
  'screen:pickColor': [],
  'screen:captureText': [],

  // process
  'process:list': ['query', 'sortBy'],
  'process:kill': ['pids', 'force', 'confirmedProtected'],

  // systemEvents / appEvents / applicationIndex
  'systemEvents:subscribe': ['eventTypes'],
  'systemEvents:unsubscribe': ['subscriptionId'],
  'appEvents:subscribe': ['eventTypes'],
  'appEvents:unsubscribe': ['subscriptionId'],
  'applicationIndex:subscribe': ['eventTypes'],
  'applicationIndex:unsubscribe': ['subscriptionId'],

  // timers
  'timers:schedule': ['opts'],
  'timers:cancel': ['timerId'],
  'timers:list': [],

  // fsWatcher
  'fsWatcher:create': ['paths', 'opts'],
  'fsWatcher:dispose': ['handleId'],

  // state
  'state:get': ['key'],
  'state:set': ['key', 'value'],
  'state:subscribe': ['key', 'role'],
  'state:unsubscribe': ['subscriptionId'],
  'state:rpcRequest': ['id', 'correlationId', 'payload'],
  'state:rpcAbort': ['correlationId'],
  'state:rpcReply': ['correlationId', 'result', 'error'],

  // searchBar
  'searchBar:set': ['opts'],
  'searchBar:clear': [],

  // feedback
  'feedback:report': ['feedback'],
  'feedback:showProgress': ['options'],
  'feedback:updateProgress': ['feedbackId', 'update'],
  'feedback:finishProgress': ['feedbackId', 'outcome'],
  'feedback:dismiss': ['feedbackId'],
  'feedback:announce': ['announcement'],
  'feedback:sendBackground': ['options'],
  'feedback:dismissBackground': ['feedbackId'],
  'feedback:showHUD': ['title'],
  'feedback:confirmAlert': ['options'],

  // onboarding
  'onboarding:complete': [],

  // runs
  'runs:start': ['id', 'kind', 'label', 'cancellable', 'subjectId'],
  'runs:write': ['id', 'line'],
  'runs:done': ['id'],
  'runs:fail': ['id', 'error'],
  'runs:cancel': ['id'],

  // tools
  'tools:registerTool': ['tool'],
  'tools:unregisterTool': ['id'],
  'tools:listTools': [],

  // environment
  'environment:getEnvironment': [],

  // network
  'network:fetch': ['url', 'options'],
  'network:wsConnect': ['socketId', 'url', 'headers'],
  'network:wsSend': ['socketId', 'message'],
  'network:wsClose': ['socketId', 'code', 'reason'],

  // files
  'files:search': ['query', 'opts'],
  'files:status': [],
  'files:read': ['path', 'opts'],
  'files:glob': ['pattern', 'opts'],
  'files:thumbnail': ['path', 'opts'],

  // opener
  'opener:open': ['url'],
  'opener:openPath': ['path', 'options'],
  'opener:reveal': ['path'],

  // browser
  'browser:listAvailableBrowsers': [],
  'browser:isCompanionInstalled': ['family'],
  'browser:listBookmarks': ['filter'],
  'browser:searchHistory': ['query', 'opts'],
  'browser:listTabs': ['filter'],
  'browser:getActiveTab': ['browser'],
  'browser:activateTab': ['tabId'],
  'browser:closeTab': ['tabId'],
  'browser:openUrl': ['url', 'target'],
  'browser:listPairedBrowsers': [],
  'browser:getCurrentPage': ['browser'],
  'browser:queryPage': ['tabId', 'selector', 'attrs'],
  'browser:actOnPage': ['tabId', 'action'],
  'browser:searchWeb': ['text', 'browser'],
  'browser:getMostRecentActiveBrowser': [],
  'browser:subscribeTabsChanged': [],
  'browser:unsubscribeTabsChanged': ['subscriptionId'],
  'browser:subscribePageChanged': [],
  'browser:unsubscribePageChanged': ['subscriptionId'],

  // actions
  'actions:registerAction': ['action'],
  'actions:unregisterAction': ['actionId'],
  'actions:executeAction': ['actionId'],
  'actions:setContext': ['context', 'data'],
  'actions:registerActionHandler': ['actionId'],

  // application
  'application:getFrontmostApplication': [],
  'application:syncApplicationIndex': ['extraPaths'],
  'application:listApplications': ['extraPaths'],
  'application:isRunning': ['bundleId'],

  // calculator
  'calculator:evaluate': ['query'],

  // commands
  'commands:registerCommand': ['commandId', 'handler', 'extensionId'],
  'commands:unregisterCommand': ['commandId'],
  'commands:executeCommand': ['commandId', 'args'],
  'commands:clearCommandsForExtension': ['extensionId'],
  'commands:updateCommandMetadata': ['extensionId', 'commandId', 'subtitle'],
  'commands:replaceDynamicCommands': ['extensionId', 'regs'],

  // entitlements
  'entitlements:check': ['entitlement'],
  'entitlements:getAll': [],

  // extensions
  'extensions:init': [],
  'extensions:loadExtensions': [],
  'extensions:reloadExtensions': [],
  'extensions:toggleExtensionState': ['extensionName', 'enabled'],
  'extensions:getAllExtensionsWithState': [],
  'extensions:searchAll': ['query'],
  'extensions:handleViewSearch': ['query'],
  'extensions:handleViewSubmit': ['query'],
  'extensions:navigateToView': ['viewPath'],
  'extensions:goBack': [],
  'extensions:forwardKeyToActiveView': ['keyEvent'],
  'extensions:getAllExtensions': [],
  'extensions:uninstallExtension': ['extensionId', 'extensionName'],
  'extensions:setActiveViewActionLabel': ['label'],
  'extensions:setActiveViewSubtitle': ['subtitle'],

  // fs
  'fs:showInFileManager': ['path'],
  'fs:trash': ['path'],

  // log
  'log:debug': ['message'],
  'log:info': ['message'],
  'log:warn': ['message'],
  'log:error': ['message'],
  'log:custom': ['message', 'category', 'colorName', 'frameName'],

  // search
  'search:rank': ['query', 'items'],

  // settings
  'settings:get': ['section', 'key'],
  'settings:set': ['section', 'key', 'value'],

  // statusBar
  'statusBar:registerItem': ['item'],
  'statusBar:updateItem': ['extensionId', 'id', 'item'],
  'statusBar:unregisterItem': ['extensionId', 'id'],
  'statusBar:clearItemsForExtension': ['extensionId'],

  // window
  'window:getWindowBounds': [],
  'window:setFullscreen': ['enable'],
  'window:getMonitors': [],
  'window:applyPreset': ['presetId'],
  'window:previousDisplay': [],
  'window:nextDisplay': [],
};

export class ExtensionIpcRouter {
  private readonly deps: IpcDeps;

  constructor(
    private serviceRegistry: ServiceRegistry,
    getManifestById: (id: string) => ExtendedManifest | undefined,
    goBack: () => void,
    saveSearchIndex: () => void,
  ) {
    this.deps = {
      serviceRegistry,
      getManifestById,
      goBack,
      saveSearchIndex,
      findExtensionIdForSource: (source) => this.findExtensionIdForSource(source),
      findIframeRoleForSource: (source) => this.findIframeRoleForSource(source),
      dispatchApiCall: (type, payload, extensionId, isPrivileged, originRole) =>
        this.dispatchApiCall(type, payload, extensionId, isPrivileged, originRole),
    };
  }

  public setup(): void {
    if (typeof window === 'undefined') return;

    window.addEventListener('message', (event: MessageEvent) => {
      void this.handleMessage(event);
    });

    workerHost.setIpcHandler((event: MessageEvent) => {
      void this.handleMessage(event);
    });

    // Tier-1 built-ins run in the host window; dispatch their invokes
    // synchronously so nav-stack side effects land before the caller's
    // await resumes. This bypasses the pipeline by design — the host is the
    // privileged context. Iframes continue to use postMessage.
    messageBroker.setHostDispatcher((command, payload, extensionId) =>
      this.dispatchApiCall(`asyar:api:${command}`, payload, extensionId, true),
    );
  }

  /** Runs one incoming frame through the declared pipeline. */
  public async handleMessage(event: MessageEvent): Promise<void> {
    await runIpcPipeline(this.createContext(event));
  }

  private createContext(event: MessageEvent): IpcContext {
    const data = event.data ?? {};
    const source = event.source;
    const messageId = data.messageId;
    const isWorker = workerHost.hasSource(source);
    const post = (body: Record<string, unknown>) => {
      const resp = { type: 'asyar:response', messageId, ...body };
      if (isWorker && source && typeof (source as any).postMessage === 'function') {
        (source as any).postMessage(resp);
      } else {
        (source as WindowProxy | null)?.postMessage(resp, '*');
      }
    };

    return {
      event,
      data,
      type: data.type,
      payload: data.payload,
      messageId,
      source,
      isPrivilegedHostContext: source === window,
      deps: this.deps,
      result: undefined,
      reply: (result) => post({ result }),
      replyError: (error, errorCode, errorDetails) =>
        post({
          error,
          ...(errorCode ? { errorCode } : {}),
          ...(errorDetails ? { errorDetails } : {}),
        }),
    };
  }

  /**
   * Find the iframe or worker whose source matches `source` and read its
   * extensionId. Returns undefined when source is not a known Tier 2 context.
   */
  private findExtensionIdForSource(source: MessageEventSource | null): string | undefined {
    const workerExtId = workerHost.findExtensionIdForSource(source);
    if (workerExtId) return workerExtId;
    return this.findFrameForSource(source)?.dataset.extensionId;
  }

  /**
   * Find the role for `source`. Returns 'worker' if the source is an active
   * worker in workerHost, or reads `data-role` for iframes.
   */
  private findIframeRoleForSource(source: MessageEventSource | null): IframeRole | undefined {
    if (workerHost.hasSource(source)) return 'worker';
    const role = this.findFrameForSource(source)?.dataset.role;
    return role === 'view' || role === 'worker' ? role : undefined;
  }

  private findFrameForSource(source: MessageEventSource | null): HTMLIFrameElement | undefined {
    if (!source || typeof document === 'undefined') return undefined;
    const iframes = document.querySelectorAll<HTMLIFrameElement>('iframe[data-extension-id]');
    for (let index = 0; index < iframes.length; index += 1) {
      const frame = iframes[index];
      if (frame?.contentWindow === source) return frame;
    }
    return undefined;
  }

  private async dispatchApiCall(
    type: string,
    payload: any,
    extensionId: string | undefined,
    isPrivilegedHostContext: boolean,
    originRole?: IframeRole,
  ): Promise<unknown> {
    const parts = type.split(':');
    const serviceName = parts[2];
    const methodName = parts[3] || parts[2];

    if (type === 'asyar:api:invoke') {
      const handler = EXTENSION_INVOKE_DISPATCH[payload?.cmd];
      if (!handler) {
        if (!isPrivilegedHostContext) {
          logService.warn(
            `[PermissionGate] BLOCKED invoke: iframe extension "${extensionId}" tried to call non-allowlisted command "${payload?.cmd}"`,
          );
        }
        throw new Error(`Command "${payload?.cmd}" is not available to extensions`);
      }
      const result = await handler(payload?.args);
      if (result === null) {
        throw new HandledDispatchError(`Command "${payload?.cmd}" failed`);
      }
      return result;
    }

    if (type === 'asyar:api:snippets:registerShortcodes') {
      const { map } = payload as { map: Record<string, string> };
      const ok = await contributeShortcodes(extensionId, map);
      if (!ok) throw new HandledDispatchError('contribute_shortcodes failed');
      return undefined;
    }

    if (type === 'asyar:api:snippets:unregisterShortcodes') {
      const ok = await revokeShortcodes(extensionId);
      if (!ok) throw new HandledDispatchError('revoke_shortcodes failed');
      return undefined;
    }

    const ns = serviceName as Namespace;
    const service = this.serviceRegistry[ns] as Record<string, unknown> | undefined;
    const method = service?.[methodName];
    if (!service || typeof method !== 'function') {
      logService.warn(
        `[Main] Dispatch failed for ${type}: Service ${serviceName}.${methodName} not found`,
      );
      return undefined;
    }

    let args: unknown[];
    if (payload === null || payload === undefined) {
      args = [];
    } else if (Array.isArray(payload)) {
      args = payload;
    } else if (
      typeof payload === 'object' &&
      Array.isArray((payload as Record<string, unknown>).args) &&
      (Object.keys(payload as Record<string, unknown>).length === 1 ||
        !METHOD_PARAM_SCHEMAS[`${ns}:${methodName}`]?.includes('args'))
    ) {
      args = (payload as { args: unknown[] }).args;
    } else if (typeof payload !== 'object') {
      args = [payload];
    } else {
      const keys = Object.keys(payload as Record<string, unknown>);
      if (keys.length === 0) {
        args = [];
      } else {
        const schema = METHOD_PARAM_SCHEMAS[`${ns}:${methodName}`];
        if (schema) {
          if (schema.length === 1 && !(schema[0] in (payload as Record<string, unknown>))) {
            args = [payload];
          } else {
            args = schema.map((key) => (payload as Record<string, unknown>)[key]);
            if (!(ns === 'ai' && methodName === 'streamChat')) {
              while (
                args.length > 0 &&
                args[args.length - 1] === undefined &&
                !(schema[args.length - 1] in (payload as Record<string, unknown>))
              ) {
                args.pop();
              }
            }
          }
        } else {
          const injectedCount =
            (INJECTS_EXTENSION_ID.has(ns) && extensionId) || ALWAYS_INJECTS_CALLER_ID.has(ns)
              ? 1
              : 0;
          const expectedArgCount = Math.max(0, method.length - injectedCount);
          if (expectedArgCount === 1) {
            args = [payload];
          } else {
            logService.debug(
              `[IpcRouter] No parameter schema for ${ns}:${methodName}; falling back to Object.values`,
            );
            args = Object.values(payload as Record<string, unknown>);
          }
        }
      }
    }
    if (
      ns === 'clipboard' &&
      (methodName === 'subscribeCapture' || methodName === 'unsubscribeCapture')
    ) {
      const callerId = isPrivilegedHostContext
        ? (extensionId ??
          (typeof payload === 'string'
            ? payload
            : (payload as Record<string, unknown> | undefined)?.callerId) ??
          'clipboard-history')
        : extensionId;
      if (!callerId) {
        throw new Error(`Caller identity missing for ${type}`);
      }
      args = [callerId];
    }
    if (INJECTS_EXTENSION_ID.has(ns) && extensionId) {
      args = [extensionId, ...args];
    } else if (ALWAYS_INJECTS_CALLER_ID.has(ns)) {
      args = [isPrivilegedHostContext ? null : (extensionId ?? null), ...args];
    }
    if (
      ((ns === 'shell' && (methodName === 'spawn' || methodName === 'attach')) ||
        (ns === 'ai' && methodName === 'streamChat')) &&
      originRole
    ) {
      args = [...args, originRole];
    }
    if (ns === 'network' && methodName === 'wsConnect' && originRole) {
      args = [...args, originRole];
    }
    return await (method as (...a: unknown[]) => unknown).apply(service, args);
  }
}
