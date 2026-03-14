<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { logService } from '../../services/log/logService';

  export let extensionId: string;
  export let manifest: any;
  export let view: string | null = null; // Add view prop

  let iframeElement: HTMLIFrameElement;
  let mounted = false;

  $: iframeSrc = `/extension-runner?id=${extensionId}${view ? `&view=${view.split('/')[1] || 'DefaultView'}` : ''}`;

  onMount(() => {
    mounted = true;
    logService.info(`ExtensionIframe mounted for ${extensionId}`);

    window.addEventListener('message', handleMessage);
  });

  onDestroy(() => {
    window.removeEventListener('message', handleMessage);
  });

  function handleMessage(event: MessageEvent) {
    if (!iframeElement || event.source !== iframeElement.contentWindow) {
        return;
    }

    const { type, payload } = event.data;
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
