<script lang="ts">
  import type { SearchResult } from '../../services/search/interfaces/SearchResult';
  import { logService } from '../../services/log/logService';

  let {
    selectedItem = null,
    activeViewLabel = null
  }: {
    selectedItem?: SearchResult | null;
    activeViewLabel?: string | null;
  } = $props();

  let primaryActionLabel = $derived((() => {
    if (activeViewLabel) return activeViewLabel;
    if (!selectedItem) return null;
    switch (selectedItem.type) {
      case 'application': return 'Open Application';
      case 'command': return 'Run Command';
      default: return 'Execute Action';
    }
  })());

  $effect(() => {
    if (primaryActionLabel) {
      logService.debug(`[PrimaryActionDisplay] Action label: ${primaryActionLabel} (View label: ${activeViewLabel})`);
    } else {
      logService.debug(`[PrimaryActionDisplay] No item selected or view label.`);
    }
  });
</script>

{#if primaryActionLabel}
  <div class="flex items-center justify-end px-3 text-[var(--text-secondary)]">
    <span class="text-sm font-medium">{primaryActionLabel}</span>
    <kbd class="ml-2 px-1.5 py-0.5 text-xs border border-[var(--border-color)] rounded bg-[var(--bg-tertiary)]" style="font-family: var(--font-mono);">↵</kbd>
  </div>
{/if}
