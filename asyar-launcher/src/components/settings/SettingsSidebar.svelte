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
    /** Extra search terms matched besides the label. */
    keywords?: string[];
    /** Trailing item count (e.g. number of features). */
    count?: number;
    /** Trailing badge text (e.g. DEV). */
    badge?: string;
  }

  interface SearchResult {
    id: string;
    title: string;
    /** Parent tab / feature, shown under the title. */
    category: string;
  }

  interface AccountUser {
    name?: string | null;
    email?: string | null;
    avatarUrl?: string | null;
  }

  let {
    tabs,
    activeTab = $bindable(),
    query = $bindable(''),
    accountUser = null,
    results = [],
    onresult,
    ontabselect,
  }: {
    tabs: SidebarTab[];
    activeTab: SettingsTabId;
    query?: string;
    accountUser?: AccountUser | null;
    /** Deep matches (settings rows, features, extensions) for the current query. */
    results?: SearchResult[];
    onresult?: (result: SearchResult) => void;
    /** Fires on every tab click, including the already-active tab. */
    ontabselect?: (tab: SettingsTabId) => void;
  } = $props();

  let searchEl = $state<HTMLInputElement | undefined>(undefined);
  let highlighted = $state(0);

  // A new query or result set restarts the keyboard cursor at the top match.
  $effect(() => {
    void results;
    highlighted = 0;
  });

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

  function onSearchKeydown(e: KeyboardEvent) {
    if (results.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      highlighted = Math.min(highlighted + 1, results.length - 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      highlighted = Math.max(highlighted - 1, 0);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      onresult?.(results[highlighted]);
    }
  }

  function onWindowKeydown(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      searchEl?.focus();
    }
  }
</script>

<svelte:window onkeydown={onWindowKeydown} />

<nav class="settings-sidebar" aria-label={t('settings.title')} data-tauri-drag-region>
  <div class="search-box" data-tauri-drag-region>
    <Icon name="search" size={14} strokeWidth={2.2} class="search-icon" />
    <input
      bind:this={searchEl}
      bind:value={query}
      onkeydown={onSearchKeydown}
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
    {/if}
  </div>

  <div class="groups custom-scrollbar">
    {#each groups as group (group.id)}
      {#if group.id === 'system'}
        <div class="group-divider" role="separator"></div>
      {/if}
      <div class="group">
        {#each group.items as tab (tab.id)}
          {#if tab.id === 'account'}
            <button
              class="item profile"
              class:active={activeTab === tab.id}
              aria-current={activeTab === tab.id ? 'page' : undefined}
              onclick={() => {
                activeTab = tab.id;
                ontabselect?.(tab.id);
              }}
            >
              <span class="avatar">
                {#if accountUser?.name}
                  {accountUser.name[0].toUpperCase()}
                {:else}
                  <Icon name="user" size={16} />
                {/if}
              </span>
              <span class="profile-text">
                <span class="profile-title">{accountUser?.name || t('settings.tabs.account')}</span>
                <span class="profile-subtitle"
                  >{accountUser?.email || t('settings.nav.account_subtitle')}</span
                >
              </span>
            </button>
          {:else}
            <button
              class="item"
              class:active={activeTab === tab.id}
              aria-current={activeTab === tab.id ? 'page' : undefined}
              onclick={() => {
                activeTab = tab.id;
                ontabselect?.(tab.id);
              }}
            >
              <span class="icon-box"><Icon name={tab.icon} size={13} /></span>
              <span class="label">{tab.label}</span>
              {#if tab.count !== undefined}
                <span class="count">{tab.count}</span>
              {/if}
              {#if tab.badge}
                <span class="trailing-badge"><Badge text={tab.badge} variant="warning" mono /></span
                >
              {/if}
            </button>
          {/if}
        {/each}
      </div>
    {/each}

    {#if results.length > 0}
      <div class="group">
        <div class="group-label">{t('settings.nav.group_results')}</div>
        {#each results as result, i (result.id)}
          <button
            class="item result"
            class:highlighted={i === highlighted}
            onclick={() => onresult?.(result)}
          >
            <span class="result-text">
              <span class="label result-title">{result.title}</span>
              <span class="result-category">{result.category}</span>
            </span>
          </button>
        {/each}
      </div>
    {/if}
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
    gap: var(--space-4);
    padding: var(--space-3);
    background: var(--bg-secondary);
    border-inline-end: 1px solid var(--separator);
    overflow: hidden;
  }

  /* Overlay titlebar: keep the search field clear of the traffic lights. */
  :global(html[data-platform='macos']) .settings-sidebar {
    padding-top: calc(var(--space-10) + var(--space-1));
  }

  /* Soft recessed field, like System Settings and Raycast. */
  .search-box {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    height: calc(var(--size-lg) + var(--space-1));
    padding: 0 var(--space-3);
    box-sizing: border-box;
    background: color-mix(in srgb, var(--text-primary) 5%, var(--bg-tertiary));
    border: 1px solid var(--border-color);
    border-radius: var(--radius-full);
    box-shadow: var(--shadow-xs);
    transition:
      border-color var(--transition-fast),
      background-color var(--transition-fast),
      box-shadow var(--transition-fast);
  }

  .search-box:focus-within {
    background: var(--bg-tertiary);
    border-color: var(--accent-primary);
    box-shadow: var(--shadow-focus);
  }

  .search-box :global(.search-icon) {
    color: var(--text-secondary);
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
    font-size: var(--font-size-md);
  }

  .search-input::placeholder {
    color: var(--text-secondary);
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
    cursor: default;
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
    gap: var(--space-1);
  }

  .group {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
  }

  .group-divider {
    height: 1px;
    background: var(--separator);
    margin: var(--space-2);
    flex-shrink: 0;
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
    gap: var(--space-2);
    width: 100%;
    padding: var(--space-1) var(--space-2);
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-primary);
    cursor: default;
    text-align: start;
    transition: none;
  }

  .item.active {
    background: var(--bg-selected);
    color: var(--text-primary);
  }

  /* The active rim is a box-shadow and would swallow the global focus ring. */
  .item:focus-visible {
    box-shadow: var(--shadow-focus);
  }

  .icon-box {
    width: var(--size-md);
    height: var(--size-md);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    border-radius: var(--radius-xs);
    background: transparent;
    color: var(--text-secondary);
  }

  .item.active .icon-box {
    background: var(--accent-primary-fill);
    color: var(--text-on-accent);
  }

  .item.profile {
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-md);
  }

  .count {
    margin-inline-start: auto;
    font-family: var(--font-mono);
    font-size: var(--font-size-xs);
    color: var(--text-tertiary);
  }

  .trailing-badge {
    margin-inline-start: auto;
    display: flex;
  }

  .avatar {
    width: var(--size-xl);
    height: var(--size-xl);
    border-radius: var(--radius-full);
    background: var(--accent-primary-fill);
    color: var(--text-on-accent);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: var(--font-size-sm);
    font-weight: 600;
    flex-shrink: 0;
  }

  .profile-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
    flex: 1;
  }

  .profile-title,
  .profile-subtitle {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .profile-title {
    font-size: var(--font-size-sm);
    font-weight: 600;
    color: var(--text-primary);
  }

  .profile-subtitle {
    font-size: var(--font-size-xs);
    color: var(--text-secondary);
  }

  .label {
    font-size: var(--font-size-sm);
    font-weight: 500;
    font-family: var(--font-ui);
  }

  .item.result.highlighted {
    background: var(--bg-hover);
  }

  .result-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
    flex: 1;
  }

  .result-title,
  .result-category {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .result-category {
    font-size: var(--font-size-2xs);
    color: var(--text-tertiary);
  }

  .development-build-indicator {
    align-self: flex-start;
  }
</style>
