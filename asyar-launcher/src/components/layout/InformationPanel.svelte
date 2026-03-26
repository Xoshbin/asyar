<script lang="ts">
  import type { SearchResult } from '../../services/search/interfaces/SearchResult';
  import type { ExtensionManifest } from 'asyar-sdk';
  import { logService } from '../../services/log/logService';
  import { activeViewStatusMessage } from '../../services/ui/uiStateStore';

  let {
    selectedItem = null,
    activeViewManifest = null
  }: {
    selectedItem?: SearchResult | null;
    activeViewManifest?: ExtensionManifest | null;
  } = $props();

  let displayInfo = $derived((() => {
    if (selectedItem) {
      let icon = 'ℹ️';
      if (selectedItem.type === 'application') icon = selectedItem.icon ?? '🖥️';
      else if (selectedItem.type === 'command') icon = selectedItem.icon ?? '❯_';

      return {
        icon,
        name: selectedItem.name || 'Unknown Item',
        typeLabel: selectedItem.type ? selectedItem.type.charAt(0).toUpperCase() + selectedItem.type.slice(1) : 'Item',
      };
    } else if (activeViewManifest) {
      return {
        icon: activeViewManifest.icon ?? '🧩',
        name: activeViewManifest.name,
        typeLabel: 'Extension',
      };
    }
    return null;
  })());

  $effect(() => {
    if (displayInfo) {
      logService.debug(`[InformationPanel] Displaying: ${displayInfo.name} (${displayInfo.typeLabel})`);
    } else if (selectedItem === null && activeViewManifest === null) {
      logService.debug(`[InformationPanel] No item or view selected.`);
    }
  });
</script>

{#if displayInfo}
  <div class="flex items-center gap-2 text-sm text-[var(--text-secondary)] px-3 whitespace-nowrap overflow-hidden">
    {#if displayInfo.icon.startsWith('data:image')}
      <img
        src={displayInfo.icon}
        alt=""
        class="w-5 h-5 rounded flex-shrink-0 object-contain"
      />
    {:else}
      <span class="text-base flex-shrink-0">{displayInfo.icon}</span>
    {/if}
    <span class="font-medium text-[var(--text-primary)] truncate flex-shrink min-w-0">{displayInfo.name}</span>
    {#if $activeViewStatusMessage}
      <span class="text-xs text-[var(--text-secondary)] px-1 font-medium animate-pulse flex-shrink-0">{$activeViewStatusMessage}</span>
    {/if}
    <span class="text-[var(--text-tertiary)] capitalize flex-shrink-0">({displayInfo.typeLabel})</span>
  </div>
{:else}
  <div class="px-3 text-sm text-[var(--text-tertiary)]"> </div>
{/if}
