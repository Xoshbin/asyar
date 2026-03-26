<script lang="ts">
  import { logService as logger } from '../../services/log/logService';
  import { extensionHasInputFocus } from '../../services/ui/uiStateStore';
  import type { ExtensionManifest } from 'asyar-sdk';

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

  const isWindows = navigator.userAgent.toLowerCase().includes('windows');

  let iframeSrc = $derived(isWindows
    ? `http://asyar-extension.localhost/${extensionId}/index.html${view ? `?view=${view.split('/')[1] || 'DefaultView'}` : ''}`
    : `asyar-extension://${extensionId}/index.html${view ? `?view=${view.split('/')[1] || 'DefaultView'}` : ''}`);

  function handleMessage(event: MessageEvent) {
    if (!iframeElement || event.source !== iframeElement.contentWindow) return;
    const { type, payload } = event.data;
    if (type === 'asyar:extension:input-focus') {
      extensionHasInputFocus.set(!!payload?.focused);
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

  $effect(() => {
    logger.info(`ExtensionIframe mounted for ${extensionId}`);
    window.addEventListener('message', handleMessage);
    return () => {
      window.removeEventListener('message', handleMessage);
      extensionHasInputFocus.set(false);
    };
  });

  // Keep exported function — accessible via bind:this in Svelte 5
  export function sendMessage(type: string, payload: any) {
    if (iframeElement && iframeElement.contentWindow) {
      iframeElement.contentWindow.postMessage({ type, payload }, '*');
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
></iframe>


