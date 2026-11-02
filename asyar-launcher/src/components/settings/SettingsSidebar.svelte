<script lang="ts">
  import Badge from '../base/Badge.svelte';
  import Icon from '../base/Icon.svelte';
  import KeyboardHint from '../base/KeyboardHint.svelte';
  import { developmentBuildIndicator } from '../../lib/developmentBuild';
  import { t } from '../../services/i18n';
  import type { SettingsTabId, SidebarGroupId } from '../../routes/settings/settingsNav';

  interface SidebarTab {
    id: SettingsTabId;
    label: string;
    icon: string;
    group: SidebarGroupId;
    /** Extra search terms matched besides the label. */
    keywords?: string[];
  }

  let {
    tabs,
    activeTab = $bindable(),
    query = $bindable(''),
  }: {
    tabs: SidebarTab[];
    activeTab: SettingsTabId;
    query?: string;
  } = $props();

  let searchEl = $state<HTMLInputElement | undefined>(undefined);

  const visibleTabs = $derived.by(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tabs;
    return tabs.filter(
      (tab) =>
        tab.label.toLowerCase().includes(q) ||
        tab.keywords?.some((keyword) => keyword.toLowerCase().includes(q)),
    );
  });

  const groups = $derived(
    (['top', 'app', 'system'] as const)
      .map((id) => ({ id, items: visibleTabs.filter((tab) => tab.group === id) }))
      .filter((g) => g.items.length > 0),
  );

  function groupLabel(id: SidebarGroupId): string | null {
    if (id === 'app') return t('settings.nav.group_app');
    if (id === 'system') return t('settings.nav.group_system');
    return null;
  }

  function onWindowKeydown(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      searchEl?.focus();
    }
  }
</script>

<svelte:window onkeydown={onWindowKeydown} />

<nav class="settings-sidebar" aria-label={t('settings.title')}>
  <div class="search-box">
    <Icon name="search" size={14} class="search-icon" />
    <input
      bind:this={searchEl}
      bind:value={query}
      class="search-input"
      type="search"
      placeholder={t('settings.nav.search_placeholder')}
      aria-label={t('settings.nav.search_placeholder')}
    />
    {#if query}
      <button
        type="button"
        class="clear-btn"
        aria-label={t('settings.nav.clear_search')}
        onclick={() => {
          query = '';
          searchEl?.focus();
        }}
      >
        <Icon name="x" size={12} />
      </button>
    {:else}
      <KeyboardHint keys="⌘F" />
    {/if}
  </div>

  <div class="groups custom-scrollbar">
    {#each groups as group (group.id)}
      <div class="group">
        {#if groupLabel(group.id)}
          <div class="group-label">{groupLabel(group.id)}</div>
        {/if}
        {#each group.items as tab (tab.id)}
          <button
            class="item"
            class:active={activeTab === tab.id}
            aria-current={activeTab === tab.id ? 'page' : undefined}
            onclick={() => (activeTab = tab.id)}
          >
            <Icon name={tab.icon} size={16} />
            <span class="label">{tab.label}</span>
          </button>
        {/each}
      </div>
    {/each}
  </div>

  {#if developmentBuildIndicator}
    <span
      class="development-build-indicator"
      title={developmentBuildIndicator.title}
      aria-label={developmentBuildIndicator.title}
    >
      <Badge text={developmentBuildIndicator.text} variant="warning" mono bordered />
    </span>
  {/if}
</nav>

<style>
  .settings-sidebar {
    width: 220px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-4) var(--space-3);
    background: var(--bg-secondary);
    border-inline-end: 1px solid var(--separator);
    overflow: hidden;
  }

  .search-box {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: 0 var(--space-3);
    height: var(--size-xl);
    box-sizing: border-box;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    transition:
      border-color var(--dur-instant) var(--ease-travel),
      box-shadow var(--dur-instant) var(--ease-travel);
  }

  .search-box:focus-within {
    border-color: var(--accent-primary);
    box-shadow: var(--shadow-focus);
  }

  .search-box :global(.search-icon) {
    color: var(--text-tertiary);
    flex-shrink: 0;
  }

  .search-input {
    flex: 1;
    min-width: 0;
    height: 100%;
    padding: 0;
    border: none;
    outline: none;
    background: transparent;
    color: var(--text-primary);
    font-family: var(--font-ui);
    font-size: var(--font-size-sm);
  }

  .search-input::placeholder {
    color: var(--text-tertiary);
  }

  .search-input::-webkit-search-cancel-button {
    display: none;
  }

  .clear-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-0-5);
    border: none;
    border-radius: var(--radius-xs);
    background: transparent;
    color: var(--text-tertiary);
    cursor: pointer;
  }

  .clear-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .groups {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .group {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .group-label {
    padding: 0 var(--space-3);
    font-size: var(--font-size-xs);
    font-weight: 600;
    font-family: var(--font-ui);
    letter-spacing: var(--tracking-wide);
    color: var(--text-tertiary);
    text-transform: uppercase;
  }

  .item {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    border: none;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    text-align: start;
    transition:
      background-color var(--dur-instant) var(--ease-travel),
      color var(--dur-instant) var(--ease-travel);
  }

  .item:hover {
    background: var(--bg-hover);
  }

  .item.active {
    background: var(--bg-selected);
    box-shadow: inset 0 0 2px 0.5px var(--kbd-rim);
    color: var(--text-primary);
  }

  /* The active rim is a box-shadow and would swallow the global focus ring. */
  .item:focus-visible {
    box-shadow: var(--shadow-focus);
  }

  .label {
    font-size: var(--font-size-sm);
    font-weight: 500;
    font-family: var(--font-ui);
  }

  .item.active .label {
    font-weight: 600;
  }

  .development-build-indicator {
    align-self: flex-start;
  }
</style>
