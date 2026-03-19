<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { logService } from '../../services/log/logService';
  import { extensionHasInputFocus } from '../../services/ui/uiStateStore';

  export let extensionId: string;
  export let manifest: any;
  export let view: string | null = null; // Add view prop

  let iframeElement: HTMLIFrameElement;
  let mounted = false;

  // Use the asyar-extension protocol directly for installed extensions
  $: iframeSrc = `asyar-extension://${extensionId}/index.html${view ? `?view=${view.split('/')[1] || 'DefaultView'}` : ''}`;

  onMount(() => {
    mounted = true;
    logService.info(`ExtensionIframe mounted for ${extensionId}`);

    window.addEventListener('message', handleMessage);
  });

  onDestroy(() => {
    window.removeEventListener('message', handleMessage);
    extensionHasInputFocus.set(false);
  });

  function handleMessage(event: MessageEvent) {
    if (!iframeElement || event.source !== iframeElement.contentWindow) {
        return;
    }

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

    logService.debug(`Received message from iframe (${extensionId}): ${type}`);
  }

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

<style>
  iframe {
    width: 100%;
    height: 100%;
    border: none;
  }
</style>
