<script lang="ts">
  import type { SearchResult } from '../../services/search/interfaces/SearchResult';
  import { logService } from '../../services/log/logService';
  import { t } from '../../services/i18n';
  import { toDisplayKeys } from '../../built-in-features/shortcuts/shortcutFormatter';
  import KeyboardHint from '../base/KeyboardHint.svelte';
  import BottomBarButton from './BottomBarButton.svelte';

  let {
    selectedItem = null,
    activeViewLabel = null,
    activeViewShortcut = null,
    disabled = false,
    onclick,
  }: {
    selectedItem?: SearchResult | null;
    activeViewLabel?: string | null;
    activeViewShortcut?: string | null;
    disabled?: boolean;
    onclick?: () => void;
  } = $props();

  let primaryActionLabel = $derived(
    (() => {
      if (activeViewLabel) return activeViewLabel;
      if (!selectedItem) return null;
      if (selectedItem.primaryActionLabel) return selectedItem.primaryActionLabel;
      switch (selectedItem.type) {
        case 'application':
          return t('actions.open');
        case 'command':
          return t('actions.run');
        default:
          return t('actions.open');
      }
    })(),
  );

  let keyHints = $derived<string | string[]>(
    activeViewLabel && activeViewShortcut ? toDisplayKeys(activeViewShortcut) : '↵',
  );

  $effect(() => {
    if (primaryActionLabel) {
      logService.debug(
        `[PrimaryActionDisplay] Action label: ${primaryActionLabel} (View label: ${activeViewLabel})`,
      );
    } else {
      logService.debug(`[PrimaryActionDisplay] No item selected or view label.`);
    }
  });
</script>

{#if primaryActionLabel}
  {#if onclick}
    <BottomBarButton
      label={primaryActionLabel}
      keyHint={keyHints}
      {disabled}
      {onclick}
      class="primary-action-button"
    />
  {:else}
    <div
      class="flex items-center justify-end pl-3 text-[var(--text-secondary)] gap-[var(--space-3)]"
      class:opacity-50={disabled}
    >
      <span class="font-medium text-[var(--text-primary)]" style="font-size: var(--font-size-sm)"
        >{primaryActionLabel}</span
      >
      <KeyboardHint keys={keyHints} />
    </div>
  {/if}
{/if}

<style>
  :global(.primary-action-button .label) {
    color: var(--text-primary);
  }
</style>
