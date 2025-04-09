<script lang="ts">
  import type { SearchResult } from '../../services/search/interfaces/SearchResult';
  import { logService } from '../../services/log/logService';
  // Removed duplicate import: import type { SearchResult } from '../../services/search/interfaces/SearchResult';

  // Prop to receive the currently selected item
  export let selectedItem: SearchResult | null = null;
  // Prop for the label provided by the active view (optional)
  export let activeViewLabel: string | null = null;

  // Determine the primary action label
  $: primaryActionLabel = (() => {
    // Prioritize the label from the active view
    if (activeViewLabel) {
      return activeViewLabel;
    }

    // Fallback to logic based on selected item
    if (!selectedItem) {
      return null; // No item selected and no view label
    }

    switch (selectedItem.type) {
      case 'application':
        return 'Open Application';
      case 'command':
        // Could potentially get more specific if commands have labels
        return 'Run Command';
      // Add more cases for other types if needed
      default:
        return 'Execute Action'; // Generic fallback
    }
  })();

  // Log changes for debugging
  $: if (primaryActionLabel) {
      logService.debug(`[PrimaryActionDisplay] Action label: ${primaryActionLabel} (View label: ${activeViewLabel})`);
  } else {
      logService.debug(`[PrimaryActionDisplay] No item selected or view label.`);
  }

</script>

{#if primaryActionLabel}
  <div class="flex items-center justify-end px-3">
    <span class="text-sm font-medium text-[var(--text-primary)]">{primaryActionLabel}</span>
    <!-- Enter key symbol -->
    <span class="ml-2 px-1.5 py-0.5 text-xs border border-[var(--border-color)] rounded text-[var(--text-secondary)]">↵</span>
  </div>
{/if}
