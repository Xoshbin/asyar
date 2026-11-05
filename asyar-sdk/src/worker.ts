/**
 * asyar-sdk/worker — headless entry for worker-context extension code.
 *
 * Asserts `window.__ASYAR_ROLE__ === "worker"` at module load, before any
 * proxy is instantiated. Mis-imports fail fast with a clear message.
 *
 * Does NOT re-export the full SDK surface. Selection, interop,
 * clipboard-history, icons, and other DOM-dependent helpers are kept out
 * of the worker's import graph so the worker bundle stays small and is
 * mechanically incapable of touching the document.
 */

const globalScope =
  typeof self !== 'undefined'
    ? self
    : typeof window !== 'undefined'
      ? window
      : typeof globalThis !== 'undefined'
        ? globalThis
        : null;

const activeRole = (globalScope as { __ASYAR_ROLE__?: unknown } | null)?.__ASYAR_ROLE__;

if (activeRole !== 'worker') {
  throw new Error(
    '[asyar-sdk/worker] Imported outside a worker context. ' +
      'This entry point is intended for code running in worker contexts ' +
      "(a Tier 2 extension's background worker). " +
      'Did you mean to import from "asyar-sdk/view"?',
  );
}

import type { Namespace } from './ipc/namespaces';
import type { BaseServiceProxy } from './services/BaseServiceProxy';

import { LogServiceProxy } from './services/LogServiceProxy';
import { StorageServiceProxy } from './services/StorageServiceProxy';
import { NotesServiceProxy } from './services/NotesServiceProxy';
import { CacheServiceProxy } from './services/CacheServiceProxy';
import { SearchServiceProxy } from './services/SearchServiceProxy';
import { NetworkServiceProxy } from './services/NetworkServiceProxy';
import { ShellServiceProxy } from './services/ShellServiceProxy';
import { OAuthServiceProxy } from './services/OAuthServiceProxy';
import { FileManagerServiceProxy } from './services/FileManagerServiceProxy';
import { ApplicationServiceProxy } from './services/ApplicationService';
import { PowerServiceProxy } from './services/PowerServiceProxy';
import { MediaServiceProxy } from './services/MediaServiceProxy';
import { CalendarServiceProxy } from './services/CalendarServiceProxy';
import { ShortcutsServiceProxy } from './services/ShortcutsServiceProxy';
import { ScreenServiceProxy } from './services/ScreenServiceProxy';
import { ProcessServiceProxy } from './services/ProcessServiceProxy';
import { SystemEventsServiceProxy } from './services/SystemEventsServiceProxy';
import { TimerServiceProxy } from './services/TimerServiceProxy';
import { FileSystemWatcherServiceProxy } from './services/FileSystemWatcherService';
import { StatusBarServiceProxy } from './services/StatusBarServiceProxy';
import { CommandServiceProxy } from './services/CommandServiceProxy';
import { ExtensionStateProxy } from './services/ExtensionStateProxy';
import { ActionServiceProxy } from './services/ActionServiceProxy';
import { FeedbackServiceProxy } from './services/FeedbackServiceProxy';
import { OnboardingServiceProxy } from './services/OnboardingServiceProxy';
import { RunServiceProxy } from './services/RunServiceProxy';
import { ToolsServiceProxy } from './services/ToolsServiceProxy';
import { SnippetsServiceProxy } from './services/SnippetsServiceProxy';
import { BrowserServiceProxy } from './services/BrowserServiceProxy';
import { FilesServiceProxy } from './services/FilesServiceProxy';
import { OpenerServiceProxy } from './services/OpenerServiceProxy';
import { EnvironmentServiceProxy } from './services/EnvironmentServiceProxy';
import { CalculatorServiceProxy } from './services/CalculatorServiceProxy';
import { AiServiceProxy } from './services/AiServiceProxy';
import { McpServiceProxy } from './services/McpServiceProxy';
import { extensionRpc } from './services/ExtensionRpc';
import type { AiCompletionRequest, AiStreamChunk } from './contracts/aiProvider';

import { extensionBridge } from './ExtensionBridge';
import { ExtensionContextCore } from './ExtensionContextCore';

function buildWorkerProxyBag(): Partial<Record<Namespace, BaseServiceProxy>> {
  return {
    log: new LogServiceProxy(),
    storage: new StorageServiceProxy(),
    notes: new NotesServiceProxy(),
    cache: new CacheServiceProxy(),
    search: new SearchServiceProxy(),
    network: new NetworkServiceProxy(),
    shell: new ShellServiceProxy(),
    oauth: new OAuthServiceProxy(),
    fs: new FileManagerServiceProxy(),
    application: new ApplicationServiceProxy(),
    power: new PowerServiceProxy(),
    media: new MediaServiceProxy(),
    calendar: new CalendarServiceProxy(),
    shortcuts: new ShortcutsServiceProxy(),
    screen: new ScreenServiceProxy(),
    calculator: new CalculatorServiceProxy(),
    process: new ProcessServiceProxy(),
    systemEvents: new SystemEventsServiceProxy(),
    timers: new TimerServiceProxy(),
    fsWatcher: new FileSystemWatcherServiceProxy(),
    statusBar: new StatusBarServiceProxy(),
    commands: new CommandServiceProxy(),
    state: new ExtensionStateProxy(),
    feedback: new FeedbackServiceProxy(),
    onboarding: new OnboardingServiceProxy(),
    runs: new RunServiceProxy(),
    tools: new ToolsServiceProxy(),
    snippets: new SnippetsServiceProxy(),
    browser: new BrowserServiceProxy(),
    files: new FilesServiceProxy(),
    opener: new OpenerServiceProxy(),
    environment: new EnvironmentServiceProxy(),
    ai: new AiServiceProxy(),
    mcp: new McpServiceProxy(),
    // Role-neutral: pure postMessage forwarder. Exposes registerAction,
    // unregisterAction, and registerActionHandler so handlers for
    // notification callbacks and search-result actions can register from the
    // worker and survive view Dormant.
    actions: new ActionServiceProxy(),
  };
}

/**
 * Worker-side: intercept every `asyar:action:execute` postMessage and feed
 * RPC envelopes ({ __rpc__: "request" | "abort", ... }) into the RPC
 * dispatcher. Non-RPC actions fall through to the user's action handlers.
 *
 * Idempotent — one listener per worker iframe. Installed eagerly at module
 * load so even the very first `onRequest` registration is covered without
 * a bootstrap ordering hazard.
 */
function postToHost(message: Record<string, unknown>): void {
  if (typeof window !== 'undefined' && window.parent && window.parent !== window) {
    window.parent.postMessage(message, '*');
  } else if (typeof self !== 'undefined' && typeof (self as any).postMessage === 'function') {
    (self as any).postMessage(message);
  }
}

function installWorkerRpcInterceptor(): void {
  const scope = typeof self !== 'undefined' ? self : typeof window !== 'undefined' ? window : null;
  if (!scope || typeof scope.addEventListener !== 'function') return;
  scope.addEventListener('message', (event: Event) => {
    const data = (event as MessageEvent<unknown>).data;
    if (!data || typeof data !== 'object') return;
    const d = data as { type?: unknown; payload?: unknown };
    if (d.type !== 'asyar:action:execute') return;
    const payload = d.payload;
    if (!payload || typeof payload !== 'object') return;
    if ((payload as { __rpc__?: unknown }).__rpc__ === undefined) return;
    extensionRpc.deliverActionPayload(payload);
  });
}

installWorkerRpcInterceptor();
installToolsInvokeInterceptor();
installWebSearchInvokeInterceptor();
installWebReaderInvokeInterceptor();
installAiProviderInvokeInterceptor();

/**
 * Module-level reference to the ToolsServiceProxy installed in this worker.
 * Set once when the first `ExtensionContext` is constructed; the
 * `asyar:tools:invoke` listener reads it when dispatching to local handlers.
 */
let _workerToolsProxy: ToolsServiceProxy | undefined;

/**
 * Module-level reference to the AiServiceProxy installed in this worker.
 * Set once when the first `ExtensionContext` is constructed; the
 * `asyar:webSearch:query` listener reads it when dispatching to local handlers.
 */
let _workerAiProxy: AiServiceProxy | undefined;

/**
 * Worker-side: intercept every `asyar:tools:invoke` postMessage, dispatch to
 * the ToolsServiceProxy's local handler map, and post the response back to
 * the parent. Installed eagerly at module load so even the first
 * `registerTool` call is covered without a bootstrap ordering hazard.
 */
function installToolsInvokeInterceptor(): void {
  const scope = typeof self !== 'undefined' ? self : typeof window !== 'undefined' ? window : null;
  if (!scope || typeof scope.addEventListener !== 'function') return;
  scope.addEventListener('message', (async (event: Event) => {
    const data = (event as MessageEvent<unknown>).data;
    if (!data || typeof data !== 'object') return;
    const d = data as { type?: unknown; messageId?: unknown; payload?: unknown };
    if (d.type !== 'asyar:tools:invoke') return;
    const messageId = d.messageId as string | undefined;
    const payload = d.payload as { id?: string; args?: unknown } | undefined;
    const toolId = payload?.id;
    const args = payload?.args;
    if (typeof messageId !== 'string' || typeof toolId !== 'string') return;
    if (!_workerToolsProxy) return;
    try {
      const result = await _workerToolsProxy.invokeHandler(toolId, args);
      postToHost({ type: 'asyar:tools:invoke:response', messageId, result });
    } catch (err) {
      postToHost({
        type: 'asyar:tools:invoke:response',
        messageId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }) as EventListener);
}

/**
 * Worker-side: intercept every `asyar:webSearch:query` postMessage, dispatch to
 * the AiServiceProxy's local web search handler map, and post the normalized
 * response back to the host.
 */
function installWebSearchInvokeInterceptor(): void {
  const scope = typeof self !== 'undefined' ? self : typeof window !== 'undefined' ? window : null;
  if (!scope || typeof scope.addEventListener !== 'function') return;
  scope.addEventListener('message', (async (event: Event) => {
    const data = (event as MessageEvent<unknown>).data;
    if (!data || typeof data !== 'object') return;
    const d = data as { type?: unknown; messageId?: unknown; payload?: unknown };
    if (d.type !== 'asyar:webSearch:query') return;
    const messageId = d.messageId as string | undefined;
    const payload = d.payload as
      | {
          engineId?: string;
          query?: string;
          limit?: number;
          apiKey?: string;
          baseUrl?: string;
        }
      | undefined;
    const engineId = payload?.engineId;
    if (
      typeof messageId !== 'string' ||
      typeof engineId !== 'string' ||
      !/^[a-z0-9_-]{1,64}$/.test(engineId)
    ) {
      return;
    }
    if (!_workerAiProxy) return;
    const controller = new AbortController();
    try {
      const result = await _workerAiProxy.invokeWebSearchHandler(
        engineId,
        {
          query: payload?.query ?? '',
          limit: payload?.limit ?? 5,
          apiKey: payload?.apiKey,
          baseUrl: payload?.baseUrl,
        },
        controller.signal,
      );
      postToHost({ type: 'asyar:webSearch:response', messageId, result });
    } catch (err) {
      postToHost({
        type: 'asyar:webSearch:response',
        messageId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }) as EventListener);
}

/**
 * Worker-side: intercept every `asyar:webReader:query` postMessage, dispatch to
 * the AiServiceProxy's local web reader handler map, and post the normalized
 * response back to the host.
 */
function installWebReaderInvokeInterceptor(): void {
  const scope = typeof self !== 'undefined' ? self : typeof window !== 'undefined' ? window : null;
  if (!scope || typeof scope.addEventListener !== 'function') return;

  const activeReaders = new Map<string, AbortController>();

  scope.addEventListener('message', (async (event: Event) => {
    const data = (event as MessageEvent<unknown>).data;
    if (!data || typeof data !== 'object') return;
    const d = data as { type?: unknown; messageId?: unknown; payload?: unknown };

    if (d.type === 'asyar:webReader:abort') {
      const messageId = d.messageId as string | undefined;
      if (typeof messageId === 'string' && activeReaders.has(messageId)) {
        activeReaders.get(messageId)?.abort(new Error('Aborted by host'));
        activeReaders.delete(messageId);
      }
      return;
    }

    if (d.type !== 'asyar:webReader:query') return;
    const messageId = d.messageId as string | undefined;
    const payload = d.payload as
      | {
          readerId?: string;
          url?: string;
          apiKey?: string;
          baseUrl?: string;
        }
      | undefined;
    const readerId = payload?.readerId;
    if (
      typeof messageId !== 'string' ||
      typeof readerId !== 'string' ||
      !/^[a-z0-9_-]{1,64}$/.test(readerId)
    ) {
      return;
    }
    if (!_workerAiProxy) return;
    const controller = new AbortController();
    activeReaders.set(messageId, controller);
    try {
      const result = await _workerAiProxy.invokeWebReaderHandler(
        readerId,
        {
          url: payload?.url ?? '',
          apiKey: payload?.apiKey ?? undefined,
          baseUrl: payload?.baseUrl ?? undefined,
        },
        controller.signal,
      );
      postToHost({ type: 'asyar:webReader:response', messageId, result });
    } catch (err) {
      postToHost({
        type: 'asyar:webReader:response',
        messageId,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      activeReaders.delete(messageId);
    }
  }) as EventListener);
}

/**
 * Worker-side: intercept `asyar:aiProvider:*` postMessages, dispatch to
 * the AiServiceProxy's local AI provider map, and stream chunks / responses
 * back to the host.
 */
function installAiProviderInvokeInterceptor(): void {
  const scope = typeof self !== 'undefined' ? self : typeof window !== 'undefined' ? window : null;
  if (!scope || typeof scope.addEventListener !== 'function') return;

  const activeStreams = new Map<string, AbortController>();

  scope.addEventListener('message', (async (event: Event) => {
    const data = (event as MessageEvent<unknown>).data;
    if (!data || typeof data !== 'object') return;
    const d = data as {
      type?: unknown;
      messageId?: unknown;
      providerId?: unknown;
      payload?: unknown;
      config?: unknown;
    };

    if (d.type === 'asyar:aiProvider:abort') {
      const messageId = d.messageId as string | undefined;
      if (typeof messageId === 'string' && activeStreams.has(messageId)) {
        activeStreams.get(messageId)?.abort(new Error('Aborted by host'));
        activeStreams.delete(messageId);
      }
      return;
    }

    if (d.type === 'asyar:aiProvider:listModels') {
      const messageId = d.messageId as string | undefined;
      const providerId = d.providerId as string | undefined;
      const config = d.config as Record<string, unknown> | undefined;
      if (
        typeof messageId !== 'string' ||
        typeof providerId !== 'string' ||
        !/^[a-z0-9_-]{1,64}$/.test(providerId)
      ) {
        return;
      }
      if (!_workerAiProxy) return;
      const controller = new AbortController();
      try {
        const models = await _workerAiProxy.invokeAiProviderListModels(
          providerId,
          config ?? {},
          controller.signal,
        );
        postToHost({ type: 'asyar:aiProvider:listModelsResponse', messageId, models });
      } catch (err) {
        postToHost({
          type: 'asyar:aiProvider:listModelsResponse',
          messageId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      return;
    }

    if (d.type === 'asyar:aiProvider:streamRequest') {
      const messageId = d.messageId as string | undefined;
      const providerId = d.providerId as string | undefined;
      const payload = d.payload as AiCompletionRequest | undefined;
      if (
        typeof messageId !== 'string' ||
        typeof providerId !== 'string' ||
        !/^[a-z0-9_-]{1,64}$/.test(providerId)
      ) {
        return;
      }
      if (!_workerAiProxy) return;
      const controller = new AbortController();
      activeStreams.set(messageId, controller);

      const onChunk = (chunk: AiStreamChunk) => {
        postToHost({ type: 'asyar:aiProvider:chunk', messageId, chunk });
      };

      try {
        await _workerAiProxy.invokeAiProviderStream(
          providerId,
          payload ?? { messages: [], modelId: '', maxTokens: 4096 },
          onChunk,
          controller.signal,
        );
        postToHost({ type: 'asyar:aiProvider:complete', messageId });
      } catch (err) {
        postToHost({
          type: 'asyar:aiProvider:error',
          messageId,
          error: err instanceof Error ? err.message : String(err),
        });
      } finally {
        activeStreams.delete(messageId);
      }
    }
  }) as EventListener);
}

// Auto-report uncaught errors / rejections to host parent (Task 24).
const errorScope =
  typeof self !== 'undefined' ? self : typeof window !== 'undefined' ? window : null;
if (errorScope && typeof errorScope.addEventListener === 'function') {
  errorScope.addEventListener('error', ((e: ErrorEvent) => {
    postToHost({
      type: 'asyar:feedback:uncaught',
      payload: {
        kind: 'iframe_uncaught',
        developerDetail: e.error?.stack ?? String(e.message),
      },
    });
  }) as EventListener);

  errorScope.addEventListener('unhandledrejection', ((e: PromiseRejectionEvent) => {
    postToHost({
      type: 'asyar:feedback:uncaught',
      payload: {
        kind: 'iframe_unhandled_rejection',
        developerDetail: String(e.reason),
      },
    });
  }) as EventListener);
}

export class ExtensionContext extends ExtensionContextCore {
  constructor() {
    const proxies = buildWorkerProxyBag();
    super({ role: 'worker', proxies });
    // Wire up the module-level tools proxy reference so the
    // asyar:tools:invoke interceptor can dispatch to local handlers.
    _workerToolsProxy = proxies.tools as ToolsServiceProxy | undefined;
    _workerAiProxy = proxies.ai as AiServiceProxy | undefined;
  }

  protected override notifyBridgeIfAvailable(id: string): void {
    extensionBridge.registerActiveContext(id, this);
  }

  protected override notifyRpcIfAvailable(id: string): void {
    // Patch the extensionRpc singleton's broker so worker-side
    // state:rpcReply messages carry the extensionId. Without this,
    // the launcher's IPC router rejects every rpc reply and the view's
    // context.request(...) times out even though the worker handler ran.
    extensionRpc.setExtensionId(id);
  }

  /**
   * Worker-side RPC entry. Registers `handler` for the given `id`. Returns
   * a disposer that unregisters the handler.
   *
   * The `handler` receives the request payload as its first argument and an
   * `AbortSignal` as its second argument. The signal fires when the
   * view-side timeout elapses, so long-running handlers can bail at yield
   * points (`signal.aborted`) or pass the signal into AbortController-aware
   * APIs such as `fetch`. Handlers that ignore the signal still produce a
   * leak — but a detectable one: the late reply is silently dropped by the
   * view-side SDK.
   */
  onRequest<TPayload = unknown, TResult = unknown>(
    id: string,
    handler: (payload: TPayload, signal: AbortSignal) => Promise<TResult>,
  ): () => void {
    return extensionRpc.onRequest(
      id,
      handler as unknown as (payload: unknown, signal: AbortSignal) => Promise<unknown>,
    );
  }
}

export { messageBroker, MessageBroker } from './ipc/MessageBroker';
export type { IPCMessage, IPCResponse, HostDispatcher } from './ipc/MessageBroker';
export { NAMESPACES, isNamespace } from './ipc/namespaces';
export type { Namespace, WireCommand } from './ipc/namespaces';
export { extensionBridge, ExtensionBridge } from './ExtensionBridge';
export { PreferencesFacade } from './PreferencesFacade';
export type { PreferencesSnapshot } from './PreferencesFacade';
export { environment } from './environment';
export type { EnvironmentSnapshot, IEnvironmentService } from './types/EnvironmentType';
export { McpServiceProxy } from './services/McpServiceProxy';
export type { IMcpService, McpServerInfo, McpToolDescriptor } from './contracts/IMcpService';
export type {
  GroundingSource,
  SearchResultEntry,
  WebSearchResult,
  WebSearchQuery,
  WebSearchHandler,
  WebSearchEngineRegistration,
  ManifestWebSearchEngine,
} from './contracts/webSearch';
export type {
  AiToolCall,
  AiMessage,
  AiToolDefinition,
  AiCompletionRequest,
  AiStreamChunk,
  AiModelInfo,
  AiProviderConfig,
  AiStreamCallback,
  AiProviderCompleteStream,
  AiProviderListModels,
  AiProviderRegistration,
  ManifestAiModel,
  ManifestAiProvider,
} from './contracts/aiProvider';
export * from './errors';
