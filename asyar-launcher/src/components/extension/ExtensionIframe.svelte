<script lang="ts">
  import { logService as logger } from '../../services/log/logService';
  import { extensionIframeManager } from '../../services/extension/extensionIframeManager.svelte';
  import type { ExtensionManifest } from 'asyar-sdk';
  import { collectThemeVariables } from '../../lib/themeVariables';
  import { buildFontFaceCSS } from '../../lib/themeFonts';

  let {
    extensionId,
    manifest,
    view = null
  }: {
    extensionId: string;
    manifest: ExtensionManifest | null;
    view?: string | null;
  } = $props();

  let iframeElement = $state<HTMLIFrameElement>();
  let fontCSS: Promise<string> | null = null;

  const isWindows = navigator.userAgent.toLowerCase().includes('windows');

  let iframeSrc = $derived(isWindows
    ? `http://asyar-extension.localhost/${extensionId}/index.html${view ? `?view=${view.split('/')[1] || 'DefaultView'}` : ''}`
    : `asyar-extension://${extensionId}/index.html${view ? `?view=${view.split('/')[1] || 'DefaultView'}` : ''}`);

  function handleMessage(event: MessageEvent) {
    if (!iframeElement || event.source !== iframeElement.contentWindow) return;
    const { type, payload } = event.data;
    if (type === 'asyar:extension:input-focus') {
      extensionIframeManager.hasInputFocus = !!payload?.focused;
      return;
    }
    if (type === 'asyar:extension:keydown') {
      const { key, metaKey, ctrlKey, shiftKey, altKey } = payload || {};
      const syntheticEvent = new KeyboardEvent('keydown', {
        key, metaKey, ctrlKey, shiftKey, altKey,
        bubbles: true, cancelable: true,
      });
      window.dispatchEvent(syntheticEvent);
      return;
    }
    logger.debug(`Received message from iframe (${extensionId}): ${type}`);
  }

  async function handleIframeLoad() {
    sendMessage('asyar:theme:variables', collectThemeVariables(document.documentElement));
    const css = await (fontCSS ?? buildFontFaceCSS());
    sendMessage('asyar:theme:fonts', css);
  }

  $effect(() => {
    logger.info(`ExtensionIframe mounted for ${extensionId}`);
    window.addEventListener('message', handleMessage);

    // Warm up the font cache eagerly
    fontCSS = buildFontFaceCSS();

    const observer = new MutationObserver(() => {
      sendMessage('asyar:theme:variables', collectThemeVariables(document.documentElement));
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    return () => {
      window.removeEventListener('message', handleMessage);
      observer.disconnect();
      extensionIframeManager.hasInputFocus = false;
    };
  });

  import { getExtensionFrameOrigin } from '../../lib/ipc/extensionOrigin';

  // Keep exported function — accessible via bind:this in Svelte 5
  export function sendMessage(type: string, payload: any) {
    if (iframeElement && iframeElement.contentWindow) {
      iframeElement.contentWindow.postMessage(
        { type, payload },
        getExtensionFrameOrigin(extensionId)
      );
    }
  }
</script>

<iframe
  bind:this={iframeElement}
  data-extension-id={extensionId}
  src={iframeSrc}
  title="Extension Sandbox - {manifest?.name || extensionId}"
  class="w-full h-full border-none bg-transparent"
  sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
  onload={handleIframeLoad}
></iframe>


