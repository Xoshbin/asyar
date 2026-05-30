<script lang="ts">
  import { helpViewState } from './helpState.svelte';
  import { LAUNCHER_SHORTCUTS } from '../../lib/keyboard/shortcutCatalog';
  import Icon from '../../components/base/Icon.svelte';
  import { getBuiltInIconName, isBuiltInIcon } from '../../lib/iconUtils';
</script>

<div class="help-view">
  <section class="cheat-sheet">
    <h2 class="section-title">Keyboard Shortcuts</h2>
    <ul class="shortcut-list">
      {#each LAUNCHER_SHORTCUTS as s}
        <li class="shortcut-row">
          <span class="keys">
            {#each s.keys as k}<kbd>{k}</kbd>{/each}
          </span>
          <span class="label">{s.label}</span>
        </li>
      {/each}
    </ul>
  </section>

  <section class="topics">
    <h2 class="section-title">Feature Guides</h2>
    <ul class="topic-list">
      {#each helpViewState.filtered as topic, i}
        <li class="topic-row" class:selected={i === helpViewState.selectedIndex}>
          {#if isBuiltInIcon(topic.icon)}
            <Icon name={getBuiltInIconName(topic.icon)} />
          {/if}
          <span class="topic-text">
            <span class="topic-title">{topic.title}</span>
            <span class="topic-subtitle">{topic.subtitle}</span>
          </span>
        </li>
      {/each}
      {#if helpViewState.filtered.length === 0}
        <li class="empty">No topics match your search.</li>
      {/if}
    </ul>
  </section>
</div>

<style>
  .help-view {
    display: flex;
    flex-direction: column;
    gap: var(--space-6, 16px);
    padding: var(--space-5, 12px);
    overflow-y: auto;
    height: 100%;
  }

  .section-title {
    font-size: var(--font-size-xs, 11px);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-tertiary, #888);
    margin: 0 0 var(--space-2, 6px);
    font-weight: 600;
  }

  .shortcut-list,
  .topic-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
  }

  .shortcut-row {
    display: flex;
    align-items: center;
    gap: var(--space-4, 10px);
    padding: var(--space-1, 3px) var(--space-2, 6px);
  }

  .keys {
    display: inline-flex;
    gap: 3px;
    min-width: 88px;
    flex-shrink: 0;
  }

  kbd {
    font-family: inherit;
    font-size: 11px;
    padding: 1px 6px;
    border-radius: 4px;
    background: var(--bg-secondary, #2a2a2a);
    border: 1px solid var(--separator, #3a3a3a);
    color: var(--text-primary, #ddd);
  }

  .label {
    font-size: var(--font-size-sm, 13px);
    color: var(--text-secondary, #bbb);
  }

  .topic-row {
    display: flex;
    align-items: center;
    gap: var(--space-3, 8px);
    padding: var(--space-2, 6px) var(--space-3, 8px);
    border-radius: var(--radius-md, 8px);
    cursor: default;
  }

  .topic-row.selected {
    background: var(--surface-selected, rgba(255, 255, 255, 0.08));
  }

  .topic-text {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .topic-title {
    font-size: var(--font-size-sm, 13px);
    color: var(--text-primary, #eee);
  }

  .topic-subtitle {
    font-size: var(--font-size-xs, 11px);
    color: var(--text-tertiary, #888);
  }

  .empty {
    font-size: var(--font-size-sm, 13px);
    color: var(--text-tertiary, #888);
    padding: var(--space-3, 8px) var(--space-2, 6px);
  }
</style>
