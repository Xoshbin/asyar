<script lang="ts">
  import { activeView } from '../../services/extension/viewManager';
  
  interface Props {
    extensions: Array<{ id: string; isBuiltIn: boolean; searchable: boolean }>;
  }
  
  let { extensions }: Props = $props();
  
  const activeExtensionId = $derived($activeView?.split('/')[0] || null);
  
  // Only Tier 2 (not built-in) extensions with searchable: true
  // AND not currently active in a view
  const searchableExtensions = $derived(
    extensions.filter(ext => !ext.isBuiltIn && ext.searchable && ext.id !== activeExtensionId)
  );

  const isWindows = typeof navigator !== 'undefined' && navigator.userAgent.toLowerCase().includes('windows');
</script>

{#each searchableExtensions as ext (ext.id)}
  {@const src = isWindows
    ? `http://asyar-extension.localhost/${ext.id}/index.html`
    : `asyar-extension://${ext.id}/index.html`}
  <iframe
    data-extension-id={ext.id}
    data-background="true"
    src={src}
    style="display: none; width: 0; height: 0; border: 0;"
    sandbox="allow-scripts allow-same-origin"
    title="Background: {ext.id}"
  ></iframe>
{/each}
