<script lang="ts">
  import { onMount } from 'svelte';
  import { open } from '@tauri-apps/plugin-dialog';
  import { emit } from '@tauri-apps/api/event';
  import { Icon, Toggle, KeyboardHint, EmptyState, SettingsCard } from '../../../components';
  import { settingsService } from '../../../services/settings/settingsService.svelte';
  import {
    getDefaultAppScanPaths,
    listApplications,
    normalizeScanPath,
    setFocusLock,
  } from '../../../lib/ipc/commands';
  import { logService } from '../../../services/log/logService';
  import ShortcutCapture from '../../../built-in-features/shortcuts/ShortcutCapture.svelte';
  import {
    shortcutStore,
    type ItemShortcut,
  } from '../../../built-in-features/shortcuts/shortcutStore.svelte';
  import { shortcutService } from '../../../built-in-features/shortcuts/shortcutService';
  import { toDisplayString } from '../../../built-in-features/shortcuts/shortcutFormatter';
  import { aliasStore } from '../../../built-in-features/aliases/aliasStore.svelte';
  import { aliasService } from '../../../built-in-features/aliases/aliasService';
  import AliasCapture from '../../../built-in-features/aliases/AliasCapture.svelte';
  import type { Application } from '../../../bindings';

  type IndexedApp = Application & { id: string };

  let apps = $state<IndexedApp[]>([]);
  let defaultPaths = $state<string[]>([]);
  let isLoading = $state(true);
  let isBrowsing = $state(false);
  let errorMessage = $state<string | null>(null);
  let editingApp = $state<IndexedApp | null>(null);
  let editingAliasApp = $state<IndexedApp | null>(null);

  let userPaths = $derived(settingsService.currentSettings.search.additionalScanPaths ?? []);
  let enabledMap = $derived(settingsService.currentSettings.search.applicationEnabled ?? {});
  let defaultSet = $derived(new Set(defaultPaths));

  let shortcutsByObjectId = $derived(
    new Map<string, ItemShortcut>(shortcutStore.shortcuts.map((s) => [s.objectId, s])),
  );

  let pathRows = $derived([
    ...defaultPaths.map((path) => ({ path, readonly: true })),
    ...userPaths.map((path) => ({ path, readonly: false })),
  ]);

  let sortedApps = $derived([...apps].sort((a, b) => a.name.localeCompare(b.name)));

  let appFilterQuery = $state('');
  let filteredApps = $derived(
    appFilterQuery.trim()
      ? sortedApps.filter((a) => a.name.toLowerCase().includes(appFilterQuery.trim().toLowerCase()))
      : sortedApps,
  );

  function withIds(list: Application[]): IndexedApp[] {
    return list.filter((a): a is IndexedApp => typeof a.id === 'string' && a.id.length > 0);
  }

  onMount(async () => {
    try {
      const [paths, loaded] = await Promise.all([
        getDefaultAppScanPaths(),
        listApplications(userPaths),
      ]);
      defaultPaths = paths ?? [];
      apps = withIds(loaded ?? []);
      void aliasStore.refresh().catch((e) => {
        logService.warn(`Failed to refresh alias store: ${e}`);
      });
    } catch (err) {
      logService.warn(`Failed to load applications: ${err}`);
    } finally {
      isLoading = false;
    }
  });

  async function reloadApps() {
    try {
      apps = withIds((await listApplications(userPaths)) ?? []);
    } catch (err) {
      logService.warn(`Failed to reload applications: ${err}`);
    }
  }

  async function persistPaths(paths: string[]) {
    const ok = await settingsService.updateSettings('search', {
      additionalScanPaths: paths,
    });
    if (!ok) {
      errorMessage = 'Failed to save directory list';
      return;
    }
    errorMessage = null;
    await emit('asyar:app-scan-paths-changed', { additionalScanPaths: paths });
    await reloadApps();
  }

  async function handleAddDirectory() {
    if (isBrowsing) return;
    isBrowsing = true;
    errorMessage = null;
    try {
      await setFocusLock(true);
      const picked = await open({
        directory: true,
        multiple: false,
        title: 'Add Application Directory',
      });
      if (!picked || typeof picked !== 'string') return;

      const normalized = await normalizeScanPath(picked);
      if (!normalized) return;

      if (defaultSet.has(normalized)) {
        errorMessage = `${normalized} is already scanned by default`;
        return;
      }
      if (userPaths.includes(normalized)) {
        errorMessage = `${normalized} is already in the list`;
        return;
      }

      await persistPaths([...userPaths, normalized]);
    } catch (err) {
      logService.warn(`Directory picker failed: ${err}`);
      errorMessage = 'Could not open directory picker';
    } finally {
      await setFocusLock(false);
      isBrowsing = false;
    }
  }

  async function handleRemoveDirectory(path: string) {
    await persistPaths(userPaths.filter((p) => p !== path));
  }

  function isEnabled(appId: string): boolean {
    return enabledMap[appId] !== false;
  }

  async function handleToggleEnabled(app: IndexedApp) {
    const next = { ...enabledMap, [app.id]: !isEnabled(app.id) };
    await settingsService.updateSettings('search', { applicationEnabled: next });
  }

  function openShortcutCapture(app: IndexedApp) {
    editingApp = app;
  }

  async function handleShortcutSave(detail: {
    modifier: string;
    key: string;
  }): Promise<string | true> {
    if (!editingApp) return 'No application selected';
    const shortcut = `${detail.modifier}+${detail.key}`;
    const result = await shortcutService.register(
      editingApp.id,
      editingApp.name,
      'application',
      shortcut,
      editingApp.path,
      editingApp.icon ?? undefined,
    );
    if (!result.ok) {
      const reason = result.conflict?.itemName ?? 'Unsupported key or OS error';
      return `Could not assign: ${reason}`;
    }
    return true;
  }

  async function handleRemoveShortcut(app: IndexedApp) {
    await shortcutService.unregister(app.id);
  }

  function openAliasCapture(app: IndexedApp) {
    editingAliasApp = app;
  }

  async function handleRemoveAlias(app: IndexedApp) {
    const alias = aliasStore.byObjectId.get(app.id);
    if (!alias) return;
    try {
      await aliasService.unregister(alias);
      aliasStore.removeOptimistic(alias);
    } catch (e) {
      logService.warn(`Failed to remove alias for ${app.name}: ${e}`);
    }
  }
</script>

<div class="section-header">Search scope</div>
<div id="applications-scope">
  <SettingsCard>
    <ul class="path-list">
      {#each pathRows as row (row.path)}
        <li class="path-row">
          <Icon name="layers" size={14} class="path-icon" />
          <span class="path-text" title={row.path}>{row.path}</span>
          {#if row.readonly}
            <span class="default-tag">Default</span>
          {:else}
            <button
              type="button"
              class="btn btn-danger remove-btn"
              aria-label="Remove {row.path}"
              onclick={() => handleRemoveDirectory(row.path)}
            >
              <Icon name="trash" size={14} />
            </button>
          {/if}
        </li>
      {/each}
      <li class="add-directory-row">
        <button
          type="button"
          class="add-directory-btn"
          onclick={handleAddDirectory}
          disabled={isBrowsing}
        >
          <Icon name="plus" size={14} />
          {isBrowsing ? 'Opening…' : 'Add directory'}
        </button>
      </li>
    </ul>
  </SettingsCard>
  {#if errorMessage}
    <div class="error" role="alert">{errorMessage}</div>
  {/if}
</div>

<div class="applications-header-row">
  <div class="section-header applications-header-label">Applications</div>
  <div class="filter-box">
    <Icon name="search" size={13} strokeWidth={2} class="filter-icon" />
    <input
      type="text"
      class="filter-input"
      placeholder="Filter apps"
      aria-label="Filter applications"
      bind:value={appFilterQuery}
    />
  </div>
</div>

<div id="applications-list">
  {#if isLoading}
    <div class="empty">Loading applications…</div>
  {:else if filteredApps.length === 0}
    {#if appFilterQuery.trim()}
      <EmptyState
        message="No applications match your filter"
        description="Try a different search term."
      />
    {:else}
      <EmptyState
        message="No applications found"
        description="Add a directory above to scan for apps."
      />
    {/if}
  {:else}
    <SettingsCard>
      <div class="app-table" role="table">
        <div class="app-table-head" role="row">
          <span class="col-name" role="columnheader">Name</span>
          <span class="col-alias" role="columnheader">Alias</span>
          <span class="col-hotkey" role="columnheader">Hotkey</span>
          <span class="col-enabled" role="columnheader">On</span>
        </div>

        {#each filteredApps as app (app.id)}
          {@const shortcut = shortcutsByObjectId.get(app.id)}
          <div class="app-row" role="row">
            <div class="col-name" role="cell">
              {#if app.icon}
                <img class="app-icon" src={app.icon} alt="" />
              {:else}
                <span class="app-icon app-icon-fallback" aria-hidden="true">🖥️</span>
              {/if}
              <span class="app-name" title={app.path}>{app.name}</span>
            </div>
            <div class="col-alias" role="cell">
              {#if aliasStore.byObjectId.has(app.id)}
                <button
                  type="button"
                  class="kbd-btn"
                  onclick={() => openAliasCapture(app)}
                  title="Change alias"
                >
                  <span class="alias-pill text-mono">{aliasStore.byObjectId.get(app.id)}</span>
                </button>
                <button
                  type="button"
                  class="clear-btn"
                  aria-label="Remove alias for {app.name}"
                  onclick={() => handleRemoveAlias(app)}
                >
                  ✕
                </button>
              {:else}
                <button type="button" class="row-action" onclick={() => openAliasCapture(app)}>
                  Add alias
                </button>
              {/if}
            </div>
            <div class="col-hotkey" role="cell">
              {#if shortcut}
                <button
                  type="button"
                  class="kbd-btn"
                  onclick={() => openShortcutCapture(app)}
                  title="Reassign hotkey"
                >
                  <KeyboardHint keys={toDisplayString(shortcut.shortcut)} />
                </button>
                <button
                  type="button"
                  class="clear-btn"
                  aria-label="Remove hotkey for {app.name}"
                  onclick={() => handleRemoveShortcut(app)}
                >
                  ✕
                </button>
              {:else}
                <button type="button" class="row-action" onclick={() => openShortcutCapture(app)}>
                  Record
                </button>
              {/if}
            </div>
            <div class="col-enabled" role="cell">
              <Toggle checked={isEnabled(app.id)} onchange={() => handleToggleEnabled(app)} />
            </div>
          </div>
        {/each}
      </div>
    </SettingsCard>
  {/if}
</div>

{#if editingApp}
  <ShortcutCapture
    onsave={handleShortcutSave}
    oncancel={() => (editingApp = null)}
    ondone={() => (editingApp = null)}
    excludeObjectId={editingApp.id}
  />
{/if}

{#if editingAliasApp}
  <AliasCapture
    objectId={editingAliasApp.id}
    itemName={editingAliasApp.name}
    itemType="application"
    currentAlias={aliasStore.byObjectId.get(editingAliasApp.id)}
    onsave={() => (editingAliasApp = null)}
    oncancel={() => (editingAliasApp = null)}
  />
{/if}

<style>
  .error {
    margin-top: var(--space-3);
    padding: var(--space-2) var(--space-3);
    background: color-mix(in srgb, var(--accent-danger) 10%, transparent);
    border-radius: var(--radius-sm);
    font-size: var(--font-size-xs);
    color: var(--accent-danger);
  }

  .path-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
  }

  .path-row {
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-4) var(--space-6);
  }

  /* Applies to every .path-row unconditionally (not :not(:last-child)) —
     it also draws the divider between the last directory and the
     "Add directory" action row that follows it. .add-directory-row has
     no ::after of its own, so it never gets a trailing divider. */
  .path-row::after {
    content: '';
    position: absolute;
    left: var(--space-6);
    right: 0;
    bottom: 0;
    height: 1px;
    background: var(--border-color);
  }

  :global(.path-icon) {
    color: var(--text-tertiary);
    flex-shrink: 0;
  }

  .path-text {
    flex: 1;
    min-width: 0;
    font-size: var(--font-size-md);
    color: var(--text-primary);
    font-family: var(--font-mono);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .default-tag {
    font-size: var(--font-size-2xs);
    font-weight: 700;
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .remove-btn {
    padding: var(--space-1);
  }

  .add-directory-row {
    padding: 0;
  }

  .add-directory-btn {
    width: 100%;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-4) var(--space-6);
    background: transparent;
    border: none;
    color: var(--accent-primary);
    font-size: var(--font-size-md);
    font-weight: 600;
    cursor: pointer;
    text-align: left;
    font-family: var(--font-ui);
  }

  .add-directory-btn:hover {
    background: var(--bg-hover);
  }

  .add-directory-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .applications-header-row {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    margin: var(--space-8) 0 var(--space-3);
  }

  .applications-header-label {
    margin: 0;
    padding: 0;
  }

  .filter-box {
    flex: 1;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    max-width: 200px;
    margin-left: auto;
    padding: var(--space-2) var(--space-4);
    border-radius: var(--radius-md);
    background: var(--bg-secondary-full-opacity);
    border: 1px solid var(--border-color);
  }

  :global(.filter-icon) {
    color: var(--text-tertiary);
    flex-shrink: 0;
  }

  .filter-input {
    flex: 1;
    min-width: 0;
    background: transparent;
    border: none;
    outline: none;
    font-size: var(--font-size-sm);
    color: var(--text-primary);
    font-family: var(--font-ui);
  }

  .filter-input::placeholder {
    color: var(--text-tertiary);
  }

  .app-table {
    display: flex;
    flex-direction: column;
  }

  .app-table-head,
  .app-row {
    display: grid;
    grid-template-columns: 1fr 150px 130px 56px;
    align-items: center;
    gap: var(--space-6);
    padding: var(--space-3) var(--space-6);
  }

  .app-table-head {
    /* One step darker than --bg-tertiary so the header row stays visible
       against its parent SettingsCard (also --bg-tertiary). */
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border-color);
    font-size: var(--font-size-2xs);
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-tertiary);
  }

  .app-row {
    position: relative;
    transition: background-color var(--transition-fast);
  }

  .app-row:hover {
    background: var(--bg-hover);
  }

  .app-row:not(:last-child)::after {
    content: '';
    position: absolute;
    left: var(--space-6);
    right: 0;
    bottom: 0;
    height: 1px;
    background: var(--border-color);
  }

  .col-name {
    display: inline-flex;
    align-items: center;
    gap: var(--space-3);
    min-width: 0;
  }

  .app-icon {
    width: 22px;
    height: 22px;
    border-radius: var(--radius-sm);
    flex-shrink: 0;
  }

  .app-icon-fallback {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    font-size: var(--font-size-sm);
  }

  .app-name {
    font-size: var(--font-size-md);
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .col-hotkey {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
  }

  .row-action {
    background: transparent;
    border: none;
    padding: 0;
    font-size: var(--font-size-sm);
    font-family: var(--font-mono);
    color: var(--text-tertiary);
    cursor: pointer;
  }

  .row-action:hover {
    color: var(--accent-primary);
  }

  .alias-pill {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 18px;
    min-width: 18px;
    padding: 0 var(--space-2);
    border-radius: var(--radius-xs);
    background-color: color-mix(in srgb, var(--text-primary) 8%, transparent);
    color: var(--text-primary);
    font-size: var(--font-size-2xs);
    font-weight: 500;
    line-height: 1;
    letter-spacing: 0.02em;
    user-select: none;
  }

  .kbd-btn {
    background: transparent;
    border: none;
    padding: 0;
    cursor: pointer;
  }

  .clear-btn {
    background: transparent;
    border: none;
    padding: var(--space-0-5) var(--space-2);
    font-size: var(--font-size-xs);
    color: var(--text-tertiary);
    cursor: pointer;
    border-radius: var(--radius-xs);
  }
  .clear-btn:hover {
    color: var(--accent-danger);
    background: color-mix(in srgb, var(--accent-danger) 10%, transparent);
  }

  .col-enabled {
    display: inline-flex;
    justify-content: flex-end;
  }

  .empty {
    padding: var(--space-4);
    text-align: center;
    color: var(--text-tertiary);
    font-size: var(--font-size-sm);
  }
</style>
