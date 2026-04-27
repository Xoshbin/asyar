<script lang="ts">
  import ExtensionIframe from './ExtensionIframe.svelte';
  import { isBuiltInFeature } from '../../services/extension/extensionDiscovery';
  import { searchBarAccessoryService } from '../../services/search/searchBarAccessoryService.svelte';
  import { applyAccessoryFromCommand } from '../../services/search/applyAccessoryFromCommand';
  import type { ExtensionCommand, ExtensionManifest } from 'asyar-sdk/contracts';

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

  // Auto-declare/clear the searchbar accessory dropdown for the active
  // view-mode command. The manifest's command is matched by `component`
  // since `activeView` is `<extensionId>/<componentName>`. Cleanup runs
  // on unmount or when (extensionId, viewName) changes; the defensive
  // identity check avoids clobbering a sibling view's accessory after a
  // race.
  $effect(() => {
    if (!extensionId || !viewName) return;
    const command = manifest?.commands?.find(
      (c: ExtensionCommand) => c.component === viewName,
    );
    if (!command) return;
    const commandId = command.id;
    void applyAccessoryFromCommand(command, extensionId, commandId);
    return () => {
      const active = searchBarAccessoryService.active;
      if (
        active &&
        active.extensionId === extensionId &&
        active.commandId === commandId
      ) {
        searchBarAccessoryService.clear();
      }
    };
  });
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
