<svelte:head>
  {@html `<script type="importmap">${JSON.stringify({
    imports: {
      'svelte': `${import.meta.env.MODE === 'development' ? '/node_modules/.vite/deps' : '/_app/immutable/chunks'}/svelte.js`,
      'svelte/animate': `${import.meta.env.MODE === 'development' ? '/node_modules/.vite/deps/svelte_animate.js' : '/_app/immutable/chunks/svelte_animate.js'}`,
      'svelte/easing': `${import.meta.env.MODE === 'development' ? '/node_modules/.vite/deps/svelte_easing.js' : '/_app/immutable/chunks/svelte_easing.js'}`,
      'svelte/internal': `${import.meta.env.MODE === 'development' ? '/node_modules/.vite/deps/svelte_internal.js' : '/_app/immutable/chunks/svelte_internal.js'}`,
      'svelte/internal/client': `${import.meta.env.MODE === 'development' ? '/node_modules/.vite/deps/svelte_internal_client.js' : '/_app/immutable/chunks/svelte_internal_client.js'}`,
      'svelte/internal/disclose-version': `${import.meta.env.MODE === 'development' ? '/node_modules/.vite/deps/svelte_internal_disclose-version.js' : '/_app/immutable/chunks/svelte_internal_disclose-version.js'}`,
      'svelte/internal/flags/legacy': `${import.meta.env.MODE === 'development' ? '/node_modules/.vite/deps/svelte_internal_flags_legacy.js' : '/_app/immutable/chunks/svelte_internal_flags_legacy.js'}`,
      'svelte/internal/flags/tracing': `${import.meta.env.MODE === 'development' ? '/node_modules/.vite/deps/svelte_internal_flags_tracing.js' : '/_app/immutable/chunks/svelte_internal_flags_tracing.js'}`,
      'svelte/legacy': `${import.meta.env.MODE === 'development' ? '/node_modules/.vite/deps/svelte_legacy.js' : '/_app/immutable/chunks/svelte_legacy.js'}`,
      'svelte/motion': `${import.meta.env.MODE === 'development' ? '/node_modules/.vite/deps/svelte_motion.js' : '/_app/immutable/chunks/svelte_motion.js'}`,
      'svelte/reactivity': `${import.meta.env.MODE === 'development' ? '/node_modules/.vite/deps/svelte_reactivity.js' : '/_app/immutable/chunks/svelte_reactivity.js'}`,
      'svelte/reactivity/window': `${import.meta.env.MODE === 'development' ? '/node_modules/.vite/deps/svelte_reactivity_window.js' : '/_app/immutable/chunks/svelte_reactivity_window.js'}`,
      'svelte/store': `${import.meta.env.MODE === 'development' ? '/node_modules/.vite/deps/svelte_store.js' : '/_app/immutable/chunks/svelte_store.js'}`,
      'svelte/transition': `${import.meta.env.MODE === 'development' ? '/node_modules/.vite/deps/svelte_transition.js' : '/_app/immutable/chunks/svelte_transition.js'}`,
      'svelte/events': `${import.meta.env.MODE === 'development' ? '/node_modules/.vite/deps/svelte_events.js' : '/_app/immutable/chunks/svelte_events.js'}`,
      'asyar-api': `${import.meta.env.MODE === 'development' ? '/node_modules/.vite/deps/asyar-api.js' : '/_app/immutable/chunks/asyar-api.js'}`
    }
  })}</script>`}
</svelte:head>

<script lang="ts">
  import { onMount, onDestroy, unmount } from 'svelte';
  import { mount } from 'svelte';
  import { page } from '$app/state';
  import { logService } from '../../services/log/logService';
  import { envService } from '../../services/envService';
  import { ExtensionBridge } from 'asyar-api';

  // Local extension of the manifest type to include properties not yet in the SDK
  interface ExtendedManifest {
    id: string;
    name: string;
    version: string;
    main?: string;
    [key: string]: any;
  }

  const extensionId = page.url.searchParams.get('id');
  const viewName = page.url.searchParams.get('view') || 'ExtensionListView'; // Default view
  let error: string | null = null;
  let loading = true;
  let mountedComponent: any = null;

  // --- Bridge Implementation ---
  
  function callHost(type: string, payload: any = {}) {
    return new Promise((resolve, reject) => {
      const messageId = Math.random().toString(36).substring(7);
      
      const handler = (event: MessageEvent) => {
        if (event.data?.type === 'asyar:response' && event.data?.messageId === messageId) {
          window.removeEventListener('message', handler);
          if (event.data.success) resolve(event.data.result);
          else reject(new Error(event.data.error));
        }
      };
      
      window.addEventListener('message', handler);
      window.parent.postMessage({
        type,
        payload,
        messageId,
        extensionId
      }, '*');
    });
  }

  // Create a proxy that redirects all method calls to callHost
  function createServiceProxy(serviceName: string) {
    return new Proxy({}, {
      get: (target, prop) => {
        if (typeof prop !== 'string') return undefined;
        // Optimization: some common props
        if (prop === 'then') return undefined;

        return (...args: any[]) => {
          return callHost(`asyar:service:${serviceName}:${prop}`, args);
        };
      }
    });
  }

  // Shim for Tauri API which extensions often import directly
  const isTauri = envService.isTauri;

  function setupTauriShim() {
    if (!isTauri) {
      logService.info("[ExtensionRunner] Running in browser mode, shimming Tauri APIs");
    }
    // Shim invoke to use postMessage
    (window as any).__TAURI_INTERNALS__ = {
      invoke: async (cmd: string, args?: any) => {
        // Prevent infinite loop if the log plugin is active in the iframe
        // and tries to intercept its own logs via the shimmed invoke
        if (cmd === 'plugin:log|log') return;

        // Use console.debug directly to avoid potential recursion with logService
        // if logService is also trying to use the shimmed invoke
        console.debug(`[ExtensionRunner] Shimmed invoke: ${cmd}`, args);
        return callHost('asyar:api:invoke', { cmd, args });
      }
    };
    // Often @tauri-apps/api/core uses this
    (window as any).__TAURI_IPC__ = (message: any) => {
       // Only log if not a log message to avoid noise
       if (message?.cmd !== 'plugin:log|log') {
         console.debug('[ExtensionRunner] __TAURI_IPC__ called', message);
       }
    };
  }

  onMount(async () => {
    if (!isTauri) {
      logService.info("[ExtensionRunner] Browser mode: setting up protocol shim");
      // Shim for asyar-extension:// protocol errors in browser
      const originalAppendChild = document.head.appendChild;
      document.head.appendChild = function<T extends Node>(node: T): T {
        if (node instanceof HTMLLinkElement && node.href.startsWith('asyar-extension://')) {
          const parts = node.href.replace('asyar-extension://', '').split('/');
          const extId = parts[0];
          const remainingPath = parts.slice(1).join('/');
          const newHref = `/src/built-in-extensions/${extId}/${remainingPath}`;
          logService.debug(`[ExtensionRunner] Shimming protocol link: ${node.href} -> ${newHref}`);
          node.href = newHref;
        }
        return originalAppendChild.call(document.head, node) as T;
      };
    }

    if (!extensionId) {
      error = "No extension ID provided.";
      loading = false;
      return;
    }

    setupTauriShim();

    logService.info(`[ExtensionRunner] Booting extension: ${extensionId} (View: ${viewName})`);
    
    let manifest: ExtendedManifest;
    try {
      const manifestUrl = isTauri 
        ? `asyar-extension://${extensionId}/manifest.json`
        : `/src/built-in-extensions/${extensionId}/manifest.json`;
      
      logService.debug(`[ExtensionRunner] Fetching manifest from: ${manifestUrl}`);
      const response = await fetch(manifestUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch manifest: ${response.statusText}`);
      }
      manifest = await response.json();
    } catch (e) {
      error = `Manifest not found or invalid for extension: ${extensionId}`;
      loading = false;
      logService.error(`[ExtensionRunner] Manifest load error: ${e}`);
      return;
    }

    try {
      // Inject CSS if it exists
      const cssLink = document.createElement('link');
      cssLink.rel = 'stylesheet';
      cssLink.href = `asyar-extension://${extensionId}/index.css`;
      document.head.appendChild(cssLink);

      // Populate SDK bridge with proxies
      const bridge = ExtensionBridge.getInstance();
      
      // Basic services that should be proxied
      const services = [
        'LogService', 
        'ExtensionManager', 
        'NotificationService', 
        'ClipboardHistoryService', 
        'CommandService', 
        'ActionService'
      ];
      
      services.forEach(s => {
        bridge.registerService(s, createServiceProxy(s));
      });

      // Special handling for LogService to keep it local-ish or piped
      bridge.registerService('LogService', {
        info: (msg: string) => console.info(`[Extension:${extensionId}]`, msg),
        error: (msg: string) => console.error(`[Extension:${extensionId}]`, msg),
        debug: (msg: string) => console.debug(`[Extension:${extensionId}]`, msg),
        warn: (msg: string) => console.warn(`[Extension:${extensionId}]`, msg),
      });

      // Load extension module
      const entryPoint = manifest.main || 'index.es.js';
      const scriptUrl = isTauri
        ? `asyar-extension://${extensionId}/${entryPoint}`
        : `/src/built-in-extensions/${extensionId}/dist/${entryPoint}`;
      
      logService.debug(`[ExtensionRunner] Loading extension module from: ${scriptUrl}`);
      
      // Dynamic import
      const module = await import(/* @vite-ignore */ scriptUrl);
      const extension = module.default;

      if (!extension) {
        throw new Error('Extension module has no default export');
      }

      // Initialize extension
      logService.debug(`[ExtensionRunner] Initializing extension instance...`);
      // ExtensionBridge handles context creation in initializeExtensions if registered,
      // but here we are in a single-extension runner.
      bridge.registerManifest(manifest as any);
      bridge.registerExtensionImplementation(extensionId, extension);
      
      await bridge.initializeExtensions();
      await bridge.activateExtensions();

      // Mount the requested view
      const ViewComponent = module[viewName];
      if (ViewComponent) {
        logService.info(`[ExtensionRunner] Mounting view: ${viewName}`);
        const root = document.getElementById('extension-root');
        if (root) {
          mountedComponent = mount(ViewComponent, { target: root });
          loading = false;
          
          // Notify host that we are ready
          callHost('asyar:extension:loaded');
        } else {
          throw new Error('extension-root element not found');
        }
      } else {
        throw new Error(`View component "${viewName}" not found in extension module`);
      }

    } catch (e) {
      error = `Error booting extension: ${e}`;
      loading = false;
      logService.error(`[ExtensionRunner] Boot error for ${extensionId}: ${e}`);
    }
  });

  onDestroy(() => {
    logService.info(`[ExtensionRunner] Destroying runner for ${extensionId}`);
    if (mountedComponent) {
      logService.info(`[ExtensionRunner] Unmounting component for ${extensionId}`);
      try {
        unmount(mountedComponent);
      } catch (e) {
        logService.error(`[ExtensionRunner] Error during unmount: ${e}`);
      }
    }
  });
</script>

<div class="extension-runner-container">
  {#if loading && !error}
    <div class="status-overlay">Loading extension...</div>
  {/if}
  
  {#if error}
    <div class="status-overlay error">
      <h3>Extension Error</h3>
      <p>{error}</p>
      <button on:click={() => window.location.reload()} class="retry-btn">Retry</button>
    </div>
  {/if}
  
  <div id="extension-root"></div>
</div>

<style>
  :global(body), :global(html) {
    margin: 0;
    padding: 0;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: transparent;
  }

  .extension-runner-container {
    width: 100%;
    height: 100%;
    position: relative;
    background: transparent;
  }

  .status-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    background: #1a1a1a;
    color: #ffffff;
    z-index: 10;
  }

  .error {
    color: #ff5555;
    padding: 20px;
    text-align: center;
  }

  .retry-btn {
    margin-top: 15px;
    padding: 8px 16px;
    background: #444;
    border: none;
    color: white;
    cursor: pointer;
    border-radius: 4px;
  }

  #extension-root {
    width: 100%;
    height: 100%;
  }
</style>
