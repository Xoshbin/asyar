<script lang="ts">
  import ExtensionIframe from './ExtensionIframe.svelte';
  import { isBuiltInFeature } from '../../services/extension/extensionDiscovery';
  import type { ExtensionManifest } from 'asyar-sdk';

  interface Props {
    activeView: string;
    extensionManager: any;
  }

  let { activeView, extensionManager }: Props = $props();

  const extensionId = $derived(activeView.split('/')[0]);
  const viewName = $derived(activeView.split('/')[1] || 'DefaultView');
  const isBuiltIn = $derived(isBuiltInFeature(extensionId));
  const manifest = $derived(extensionManager.getManifestById ? extensionManager.getManifestById(extensionId) : null);
  const module = $derived(extensionManager.getLoadedExtensionModule(extensionId));
  const ActiveComponent = $derived(isBuiltIn ? (module?.[viewName] ?? module?.default?.[viewName] ?? module?.default) : null);
</script>

<div class="min-h-full flex flex-col flex-1 h-full" data-extension-view={activeView}>
  {#key extensionId}
    {#if isBuiltIn}
      {#if ActiveComponent}
        <ActiveComponent {extensionManager} />
      {:else}
        <div class="p-4 text-center text-red-500 font-mono text-sm">
          Error: Built-in feature {extensionId} has no export matching '{viewName}'
        </div>
      {/if}
    {:else}
      <ExtensionIframe
        {extensionId}
        view={activeView}
        manifest={manifest ?? null}
      />
    {/if}
  {/key}
</div>
