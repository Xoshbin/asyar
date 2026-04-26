<script lang="ts">
  import type { SearchResult } from '../../services/search/interfaces/SearchResult';
  import { logService } from '../../services/log/logService';
  import KeyboardHint from '../base/KeyboardHint.svelte';

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
  <div class="flex items-center justify-end pl-3 text-[var(--text-secondary)]" style="gap: 13px">
    <span class="font-semibold text-[var(--text-primary)]" style="font-size: var(--font-size-sm)">{primaryActionLabel}</span>
    <KeyboardHint keys="↵" />
  </div>
{/if}
