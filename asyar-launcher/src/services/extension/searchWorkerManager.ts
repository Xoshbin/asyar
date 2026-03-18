import { logService } from "../log/logService";
import type { ExtensionResult } from "asyar-api";
import type { LoadedExtensionModule } from "../extensionLoaderService";

export interface SerializedExtensionResult extends Omit<ExtensionResult, 'action'> {
  actionId: string;
}

interface PendingSearchRequest {
  resolve: (results: SerializedExtensionResult[]) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface WorkerIframe {
  extensionId: string;
  iframe: HTMLIFrameElement;
  ready: boolean;
  pendingRequests: Map<string, PendingSearchRequest>;
}

class SearchWorkerManager {
  private workers: Map<string, WorkerIframe> = new Map();
  private container: HTMLDivElement | null = null;
  private messageListener: (event: MessageEvent) => void;

  constructor() {
    this.messageListener = this.handleMessage.bind(this);
    if (typeof window !== "undefined") {
      window.addEventListener("message", this.messageListener);
    }
  }

  public initializeWorkers(extensions: Map<string, LoadedExtensionModule>): void {
    if (typeof document === "undefined") return;

    if (!this.container) {
      this.container = document.createElement("div");
      this.container.style.cssText = "position: fixed; top: -9999px; left: -9999px; width: 1px; height: 1px; overflow: hidden; pointer-events: none;";
      document.body.appendChild(this.container);
    }

    extensions.forEach((module, extensionId) => {
      // Only process non-built-in extensions
      if (module.isBuiltIn || !module.manifest) return;

      const hasResultCommand = module.manifest.commands?.some(
        (cmd) => (cmd.resultType as any) === "result"
      );

      if (hasResultCommand && !this.workers.has(extensionId)) {
        logService.debug(`Initializing search worker for extension: ${extensionId}`);
        this.createWorker(extensionId);
      }
    });
  }

  private createWorker(extensionId: string) {
    if (!this.container) return;

    const iframe = document.createElement("iframe");
    iframe.src = `asyar-extension://${extensionId}/index.html?mode=search-worker`;
    iframe.sandbox.add("allow-scripts", "allow-same-origin");
    
    const worker: WorkerIframe = {
      extensionId,
      iframe,
      ready: false,
      pendingRequests: new Map(),
    };

    this.workers.set(extensionId, worker);
    this.container.appendChild(iframe);
  }

  public destroyWorker(extensionId: string): void {
    const worker = this.workers.get(extensionId);
    if (worker) {
      // Resolve any pending requests with empty arrays
      worker.pendingRequests.forEach((req) => {
        clearTimeout(req.timer);
        req.resolve([]);
      });
      worker.pendingRequests.clear();
      
      if (worker.iframe.parentNode) {
        worker.iframe.parentNode.removeChild(worker.iframe);
      }
      this.workers.delete(extensionId);
    }
  }

  public destroyAllWorkers(): void {
    this.workers.forEach((_, id) => this.destroyWorker(id));
    if (this.container && this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }
    this.container = null;
    if (typeof window !== "undefined") {
      window.removeEventListener("message", this.messageListener);
    }
  }

  private handleMessage(event: MessageEvent) {
    const data = event.data;
    if (!data || typeof data !== "object") return;
    
    // Only handle search specific messages
    if (data.type !== "asyar:search:worker:ready" && data.type !== "asyar:search:response") {
      return;
    }

    const extensionId = data.extensionId;
    const worker = this.workers.get(extensionId);
    
    // Security: Validate source
    if (!worker || event.source !== worker.iframe.contentWindow) {
      if (worker) {
        logService.warn(`Invalid message source for search worker ${extensionId}`);
      }
      return;
    }

    if (data.type === "asyar:search:worker:ready") {
      logService.info(`Search worker ready for extension: ${extensionId}`);
      worker.ready = true;
    } else if (data.type === "asyar:search:response") {
      const messageId = data.messageId;
      const pending = worker.pendingRequests.get(messageId);
      if (pending) {
        clearTimeout(pending.timer);
        pending.resolve(data.payload?.results || []);
        worker.pendingRequests.delete(messageId);
      }
    }
  }

  private generateId(): string {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  }

  public search(extensionId: string, query: string): Promise<SerializedExtensionResult[]> {
    const worker = this.workers.get(extensionId);
    if (!worker || !worker.ready || !worker.iframe.contentWindow) {
      return Promise.resolve([]);
    }

    return new Promise((resolve) => {
      const messageId = this.generateId();
      
      const timer = setTimeout(() => {
        worker.pendingRequests.delete(messageId);
        logService.warn(`Search worker timeout for extension: ${extensionId}`);
        resolve([]);
      }, 500);

      worker.pendingRequests.set(messageId, { resolve, timer });

      worker.iframe.contentWindow!.postMessage(
        {
          type: "asyar:search:request",
          messageId,
          payload: { query },
        },
        "*"
      );
    });
  }

  public async searchAll(query: string): Promise<ExtensionResult[]> {
    const searchPromises: Promise<ExtensionResult[]>[] = [];

    this.workers.forEach((worker, extensionId) => {
      if (!worker.ready) return;

      const p = this.search(extensionId, query).then((serializedResults) => {
        // Reconstruct Action Functions
        return serializedResults.map((res) => {
          const actionFunc = () => {
            logService.debug(`Executing background worker action ${res.actionId} for ${extensionId}`);
            if (worker.iframe.contentWindow) {
              worker.iframe.contentWindow.postMessage({
                type: "asyar:search:execute-action",
                messageId: this.generateId(),
                payload: { actionId: res.actionId }
              }, "*");
            }
          };

          return {
            ...res,
            action: actionFunc,
            extensionId, // Ensure the mapped result knows its origin
          } as ExtensionResult;
        });
      }).catch((e) => {
         logService.error(`Search worker error for ${extensionId}: ${e}`);
         return [];
      });
      
      searchPromises.push(p);
    });

    const resultsArrays = await Promise.allSettled(searchPromises);
    let allResults: ExtensionResult[] = [];
    
    resultsArrays.forEach(result => {
      if (result.status === 'fulfilled') {
        allResults = allResults.concat(result.value);
      }
    });

    return allResults;
  }
}

export const searchWorkerManager = new SearchWorkerManager();
