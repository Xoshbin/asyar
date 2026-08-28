<script lang="ts">
  import { helpViewState } from './helpState.svelte';
  import { LAUNCHER_SHORTCUTS } from '../../lib/keyboard/shortcutCatalog';
  import Icon from '../../components/base/Icon.svelte';
  import { getBuiltInIconName, isBuiltInIcon } from '../../lib/iconUtils';
  import { scrollSelectedIntoView, resetListScroll } from '../../lib/listScroll';

  let listEl = $state<HTMLDivElement | undefined>();

  // Keyboard selection lives in helpViewState; keep the selected topic row visible.
  $effect(() => {
    const index = helpViewState.selectedIndex;
    const _filtered = helpViewState.filtered;
    if (!listEl) return;
    requestAnimationFrame(() => {
      if (listEl) {
        if (index >= 0) {
          scrollSelectedIntoView(listEl, index);
        } else {
          resetListScroll(listEl);
        }
      }
    });
  });
</script>

<div class="help-view custom-scrollbar" bind:this={listEl}>
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
        <li class="topic-row" class:selected={i === helpViewState.selectedIndex} data-index={i}>
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
    gap: var(--space-6);
    padding: var(--space-5);
    overflow-y: auto;
    height: 100%;
  }

  .section-title {
    font-size: var(--font-size-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-tertiary);
    margin: 0 0 var(--space-2);
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
    gap: var(--space-4);
    padding: var(--space-1) var(--space-2);
  }

  .keys {
    display: inline-flex;
    gap: var(--space-1);
    min-width: 88px;
    flex-shrink: 0;
  }

  kbd {
    font-family: inherit;
    font-size: var(--font-size-xs);
    padding: var(--space-0-5) var(--space-2);
    border-radius: var(--radius-xs);
    background: var(--bg-secondary);
    border: 1px solid var(--separator);
    color: var(--text-primary);
  }

  .label {
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
  }

  .topic-row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    cursor: default;
  }

  .topic-row.selected {
    background: var(--bg-selected);
  }

  .topic-text {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
  }

  .topic-title {
    font-size: var(--font-size-sm);
    color: var(--text-primary);
  }

  .topic-subtitle {
    font-size: var(--font-size-xs);
    color: var(--text-tertiary);
  }

  .empty {
    font-size: var(--font-size-sm);
    color: var(--text-tertiary);
    padding: var(--space-3) var(--space-2);
  }
</style>
