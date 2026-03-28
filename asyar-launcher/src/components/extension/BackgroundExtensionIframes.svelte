<script lang="ts">
  import type { ExtensionRecord } from '../../types/ExtensionRecord';
  import type { SearchResult } from '../../services/search/interfaces/SearchResult';
  import type { ExtensionManifest } from 'asyar-sdk';
  import { viewManager } from '../../services/extension/viewManager.svelte';
  import { settingsService } from '../../services/settings/settingsService.svelte';
  
  interface Props {
    extensions: Array<ExtensionRecord>;
  }
  
  let { extensions }: Props = $props();
  
  const extensionSearchEnabled = $derived(settingsService.getSettings().search.enableExtensionSearch);
  
  // Filter for extensions that should be active in the background
  // 1. Must be enabled
  // 2. Must be searchable (Tier 2)
  // 3. Must NOT be the currently active full view (that one is in ExtensionViewContainer)
  // 4. Must NOT be built-in (those don't run in iframes)
  let backgroundExtensions = $derived(extensionSearchEnabled ? extensions.filter(ext => 
    ext.enabled && 
    ext.manifest.searchable && 
    !ext.isBuiltIn &&
    ext.manifest.id !== viewManager.activeView?.split('/')[0]
  ) : []);

  const isWindows = typeof navigator !== 'undefined' && navigator.userAgent.toLowerCase().includes('windows');
</script>

{#each backgroundExtensions as ext (ext.manifest.id)}
  {@const src = isWindows
    ? `http://asyar-extension.localhost/${ext.manifest.id}/index.html`
    : `asyar-extension://${ext.manifest.id}/index.html`}
  <iframe
    data-extension-id={ext.manifest.id}
    data-background="true"
    src={src}
    style="display: none; width: 0; height: 0; border: 0;"
    sandbox="allow-scripts allow-same-origin"
    title="Background: {ext.manifest.id}"
  ></iframe>
{/each}
