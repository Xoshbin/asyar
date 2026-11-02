<script lang="ts">
  import Badge from '../base/Badge.svelte';
  import Icon from '../base/Icon.svelte';
  import { developmentBuildIndicator } from '../../lib/developmentBuild';
  import { t } from '../../services/i18n';
  import type { SettingsTabId, SidebarGroupId } from '../../routes/settings/settingsNav';

  interface SidebarTab {
    id: SettingsTabId;
    label: string;
    icon: string;
    group: SidebarGroupId;
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
    return q ? tabs.filter((tab) => tab.label.toLowerCase().includes(q)) : tabs;
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
  <div class="search-wrap">
    <input
      bind:this={searchEl}
      bind:value={query}
      class="search-input"
      type="search"
      placeholder={t('settings.nav.search_placeholder')}
      aria-label={t('settings.nav.search_placeholder')}
    />
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

  .search-input {
    width: 100%;
    box-sizing: border-box;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--separator);
    border-radius: var(--radius-md);
    background: var(--bg-primary);
    color: var(--text-primary);
    font-family: var(--font-ui);
    font-size: var(--font-size-sm);
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
    color: var(--text-secondary);
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
    transition: background-color var(--transition-normal);
  }

  .item:hover {
    background: var(--bg-hover);
  }

  .item.active {
    background: var(--bg-selected);
    color: var(--text-primary);
  }

  .label {
    font-size: var(--font-size-sm);
    font-weight: 600;
    font-family: var(--font-ui);
  }

  .development-build-indicator {
    align-self: flex-start;
  }
</style>
