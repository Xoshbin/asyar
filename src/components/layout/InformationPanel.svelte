<script lang="ts">
  import type { SearchResult } from '../../services/search/interfaces/SearchResult';
  import type { ExtensionManifest } from 'asyar-api';
  import { logService } from '../../services/log/logService';

  // Props to receive context from the parent (BottomActionBar)
  export let selectedItem: SearchResult | null = null;
  export let activeViewManifest: ExtensionManifest | null = null; // Pass the manifest directly

  // Reactive calculation for what to display
  $: displayInfo = (() => {
    if (selectedItem) {
      // Determine icon based on selected item type
      let icon = 'ℹ️'; // Default info icon
      if (selectedItem.type === 'application') icon = '🖥️';
      else if (selectedItem.type === 'command') icon = '❯_';
      // Add more type checks if needed

      return {
        icon: icon,
        name: selectedItem.name || 'Unknown Item',
        typeLabel: selectedItem.type ? selectedItem.type.charAt(0).toUpperCase() + selectedItem.type.slice(1) : 'Item', // Capitalize type
      };
    } else if (activeViewManifest) {
      // Display info for the active extension view
      return {
        icon: '🧩', // Use default extension icon for now
        name: activeViewManifest.name,
        typeLabel: 'Extension', // Label for extension views
      };
    }
    return null; // Nothing to display
  })();

  // Log changes for debugging
  $: if (displayInfo) {
      logService.debug(`[InformationPanel] Displaying: ${displayInfo.name} (${displayInfo.typeLabel})`);
  } else if (selectedItem === null && activeViewManifest === null) {
      logService.debug(`[InformationPanel] No item or view selected.`);
  }

</script>

{#if displayInfo}
  <div class="flex items-center gap-2 text-sm text-[var(--text-secondary)] px-3 whitespace-nowrap overflow-hidden">
    <span class="text-base flex-shrink-0">{displayInfo.icon}</span>
    <span class="font-medium text-[var(--text-primary)] truncate flex-shrink min-w-0">{displayInfo.name}</span>
    <span class="text-[var(--text-tertiary)] capitalize flex-shrink-0">({displayInfo.typeLabel})</span>
  </div>
{:else}
  <div class="px-3 text-sm text-[var(--text-tertiary)]"> </div>
{/if}
