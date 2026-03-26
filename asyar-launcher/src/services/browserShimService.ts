import { logService } from "./log/logService";
import { envService } from "./envService";

class BrowserShimService {
  private isInitialized = false;

  init() {
    if (this.isInitialized) return;
    if (!envService.isBrowser) return;

    this.shimTauriInternals();
    this.shimFetch();
    this.shimDOM();

    logService.info("[BrowserShim] Initializing browser-mode shims");
    logService.info("[BrowserShim] Initializing browser-mode shims");

    this.isInitialized = true;
  }

  private shimFetch() {
    const originalFetch = window.fetch;
    window.fetch = function(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      let url = "";
      if (typeof input === "string") {
        url = input;
      } else if (input instanceof URL) {
        url = input.href;
      } else {
        url = input.url;
      }

      if (url.startsWith("asyar-extension://")) {
        const parts = url.replace("asyar-extension://", "").split("/");
        const extId = parts[0];
        const remainingPath = parts.slice(1).join("/");
        
        let newUrl = `/src/built-in-extensions/${extId}/${remainingPath}`;
        
        // Handle CSS mapping for store extension
        if (extId === 'store' && remainingPath === 'index.css') {
          newUrl = `/src/built-in-extensions/store/dist/store-extension.css`;
        } else if (remainingPath === 'index.css') {
           // Generic fallback if useful
           newUrl = `/src/built-in-extensions/${extId}/dist/index.css`;
        }

        logService.debug(`[BrowserShim] Fetch shim: ${url} -> ${newUrl}`);
        return originalFetch(newUrl, init);
      }

      return originalFetch(input, init);
    };
  }

  private shimDOM() {
    if (typeof document === "undefined") return;

    const originalAppendChild = document.head.appendChild;
    document.head.appendChild = function<T extends Node>(node: T): T {
      if (node instanceof HTMLLinkElement && node.href.startsWith('asyar-extension://')) {
        const parts = node.href.replace('asyar-extension://', '').split('/');
        const extId = parts[0];
        const remainingPath = parts.slice(1).join('/');
        const newHref = `/src/built-in-extensions/${extId}/${remainingPath}`;
        logService.debug(`[BrowserShim] Link shim: ${node.href} -> ${newHref}`);
        node.href = newHref;
      }
      return originalAppendChild.call(document.head, node) as T;
    };
  }

  private shimTauriInternals() {
    // Only shim if not already present
    if ((window as any).__TAURI_INTERNALS__ === undefined) {
      logService.info("[BrowserShim] Creating mock __TAURI_INTERNALS__");
      (window as any).__TAURI_INTERNALS__ = {
        invoke: async (cmd: string, args?: any) => {
          logService.debug(`[BrowserShim] Mock invoke called: ${cmd}`);
          return null; 
        },
        // Add other internals as needed by plugins
        metadata: {
          version: "2.0.0"
        },
        plugins: {
          os: {
            platform: async () => "macos" // Mock platform string to prevent undefined errors
          }
        }
      };
    }
  }
}

export const browserShimService = new BrowserShimService();
