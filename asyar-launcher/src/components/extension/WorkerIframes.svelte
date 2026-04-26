<script lang="ts">
  import { workerRegistry } from '../../services/extension/workerRegistry.svelte';
  import extensionManager from '../../services/extension/extensionManager.svelte';
  import { computeBackgroundIframeSet } from './backgroundIframeSet';

  let toMount = $derived(
    computeBackgroundIframeSet(
      workerRegistry.entries,
      extensionManager.extensionRecords,
      null,
    ),
  );

  const isWindows =
    typeof navigator !== 'undefined' && navigator.userAgent.toLowerCase().includes('windows');
</script>

{#each toMount as entry (entry.extensionId)}
  {@const src = isWindows
    ? `http://asyar-extension.localhost/${entry.extensionId}/worker.html`
    : `asyar-extension://${entry.extensionId}/worker.html`}
  <iframe
    data-extension-id={entry.extensionId}
    data-mount-token={String(entry.mountToken)}
    data-role="worker"
    src={src}
    style="display: none; width: 0; height: 0; border: 0;"
    sandbox="allow-scripts allow-same-origin"
    title="Worker: {entry.extensionId}"
  ></iframe>
{/each}
