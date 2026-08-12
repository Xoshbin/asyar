<script lang="ts">
  import { EmptyState, Icon } from '..';
  import {
    SETTINGS_TABS,
    type SettingsSearchEntry,
  } from '../../routes/settings/settingsNavRegistry';
  import { getSearchResultsKeyAction, moveHighlightedIndex } from './settingsSearchResults.logic';

  let {
    query,
    results,
    onSelect,
  }: {
    query: string;
    results: SettingsSearchEntry[];
    onSelect: (entry: SettingsSearchEntry) => void;
  } = $props();

  const tabIcons: Record<string, string> = Object.fromEntries(
    SETTINGS_TABS.map((tab) => [tab.id, tab.icon]),
  );

  let highlightedIndex = $state(-1);
  let rowEls: (HTMLButtonElement | undefined)[] = [];

  $effect(() => {
    // A new query means a new result set — a stale index from the previous
    // search shouldn't carry over onto an unrelated row.
    void query;
    highlightedIndex = -1;
  });

  $effect(() => {
    if (highlightedIndex >= 0) {
      rowEls[highlightedIndex]?.scrollIntoView({ block: 'nearest' });
    }
  });

  function handleKeydown(e: KeyboardEvent) {
    if (results.length === 0) return;
    const action = getSearchResultsKeyAction(e);
    if (action === 'move-up' || action === 'move-down') {
      e.preventDefault();
      highlightedIndex = moveHighlightedIndex(highlightedIndex, results.length, action);
    } else if (action === 'select' && highlightedIndex >= 0) {
      e.preventDefault();
      onSelect(results[highlightedIndex]);
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="search-results custom-scrollbar">
  <div class="search-results-inner">
    <div class="search-results-eyebrow">
      {results.length}
      {results.length === 1 ? 'setting matches' : 'settings match'} "{query.trim()}"
    </div>

    {#if results.length === 0}
      <EmptyState message="No matching settings" description="Try a different search term." />
    {:else}
      <div class="search-results-list">
        {#each results as entry, i (entry.id)}
          <button
            bind:this={rowEls[i]}
            type="button"
            class="search-result-row"
            class:highlighted={i === highlightedIndex}
            aria-current={i === highlightedIndex ? 'true' : undefined}
            onclick={() => onSelect(entry)}
            onmouseenter={() => (highlightedIndex = i)}
          >
            <div class="search-result-icon">
              <Icon name={tabIcons[entry.tab] ?? 'settings'} size={16} />
            </div>
            <div class="search-result-text">
              <div class="search-result-title">{entry.title}</div>
              <div class="search-result-sub">{entry.description}</div>
            </div>
            <div class="search-result-tab">{entry.tabLabel} →</div>
          </button>
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  .search-results {
    flex: 1;
    overflow-y: auto;
    min-height: 0;
  }

  .search-results-inner {
    max-width: 760px;
    margin: 0 auto;
    padding: var(--space-8) var(--space-8) var(--space-10);
  }

  .search-results-eyebrow {
    font-size: var(--font-size-xs);
    font-weight: 700;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    color: var(--text-tertiary);
    margin-bottom: var(--space-6);
  }

  .search-results-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .search-result-row {
    display: flex;
    align-items: center;
    gap: var(--space-6);
    padding: var(--space-6) var(--space-6);
    border-radius: var(--radius-xl);
    background: var(--bg-secondary-full-opacity);
    border: 1px solid var(--border-color);
    cursor: pointer;
    text-align: left;
    font-family: var(--font-ui);
    transition: border-color var(--transition-fast);
    width: 100%;
  }

  .search-result-row:hover,
  .search-result-row.highlighted {
    background: var(--bg-hover);
  }

  .search-result-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: var(--radius-lg);
    background: var(--bg-tertiary);
    color: var(--text-secondary);
    flex-shrink: 0;
  }

  .search-result-text {
    flex: 1;
    min-width: 0;
  }

  .search-result-title {
    font-size: var(--font-size-md);
    font-weight: 600;
    color: var(--text-primary);
  }

  .search-result-sub {
    font-size: var(--font-size-xs);
    color: var(--text-secondary);
    margin-top: var(--space-1);
  }

  .search-result-tab {
    font-size: var(--font-size-xs);
    color: var(--text-tertiary);
    flex-shrink: 0;
    white-space: nowrap;
  }
</style>
