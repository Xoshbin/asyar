<script lang="ts">
  import { EmptyState } from '..';
  import type { SettingsSearchEntry } from '../../routes/settings/settingsNavRegistry';

  let {
    query,
    results,
    onSelect,
  }: {
    query: string;
    results: SettingsSearchEntry[];
    onSelect: (entry: SettingsSearchEntry) => void;
  } = $props();
</script>

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
        {#each results as entry (entry.id)}
          <button type="button" class="search-result-row" onclick={() => onSelect(entry)}>
            <div class="search-result-icon"></div>
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

  .search-result-row:hover {
    background: var(--bg-hover);
  }

  .search-result-icon {
    width: 32px;
    height: 32px;
    border-radius: var(--radius-lg);
    background: var(--bg-tertiary);
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
