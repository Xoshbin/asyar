<script lang="ts">
  import type { ExtensionRecord } from '../../types/ExtensionRecord';
  import { viewManager } from '../../services/extension/viewManager.svelte';
  import { extensionIframeRegistry } from '../../services/extension/extensionIframeRegistry.svelte';
  import extensionManager from '../../services/extension/extensionManager.svelte';
  import { computeBackgroundIframeSet } from './backgroundIframeSet';

  // The caller passes an `extensions` prop but we ignore it: that prop flows
  // through a $derived in +page.svelte that is broken for proxied singletons
  // (see extensionManager lazy-init Proxy — the subscription never refires
  // after the initial empty value). Reading extensionManager.extensionRecords
  // directly inside this component's $derived works because this component's
  // reactive scope reads the $state proxy freshly every re-evaluation.
  interface Props {
    extensions: Array<ExtensionRecord>;
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let { extensions: _ignored = [] as ExtensionRecord[] }: Props = $props();

  let toMount = $derived(
    computeBackgroundIframeSet(
      extensionIframeRegistry.entries,
      extensionManager.extensionRecords,
      viewManager.activeView,
    ),
  );

  $effect(() => {
    // eslint-disable-next-line no-console
    console.log(
      '[BG] toMount=',
      toMount.map((e) => e.extensionId),
      ' registry=',
      extensionIframeRegistry.entries.map((e) => e.extensionId),
      ' managerRecords=',
      extensionManager.extensionRecords.length,
    );
  });

  const isWindows =
    typeof navigator !== 'undefined' && navigator.userAgent.toLowerCase().includes('windows');
</script>

{#each toMount as entry (entry.extensionId)}
  {@const src = isWindows
    ? `http://asyar-extension.localhost/${entry.extensionId}/index.html`
    : `asyar-extension://${entry.extensionId}/index.html`}
  <iframe
    data-extension-id={entry.extensionId}
    data-mount-token={String(entry.mountToken)}
    data-background="true"
    src={src}
    style="display: none; width: 0; height: 0; border: 0;"
    sandbox="allow-scripts allow-same-origin"
    title="Background: {entry.extensionId}"
  ></iframe>
{/each}
