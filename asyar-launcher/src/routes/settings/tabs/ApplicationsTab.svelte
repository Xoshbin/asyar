<script lang="ts">
  import { onMount } from 'svelte';
  import { open } from '@tauri-apps/plugin-dialog';
  import { emit } from '@tauri-apps/api/event';
  import {
    Button,
    Icon,
    Toggle,
    KeyboardHint,
    EmptyState,
  } from '../../../components';
  import { settingsService } from '../../../services/settings/settingsService.svelte';
  import {
    getDefaultAppScanPaths,
    listApplications,
    normalizeScanPath,
    setFocusLock,
  } from '../../../lib/ipc/commands';
  import { logService } from '../../../services/log/logService';
  import ShortcutCapture from '../../../built-in-features/shortcuts/ShortcutCapture.svelte';
  import { shortcutStore, type ItemShortcut } from '../../../built-in-features/shortcuts/shortcutStore.svelte';
  import { shortcutService } from '../../../built-in-features/shortcuts/shortcutService';
  import { toDisplayString } from '../../../built-in-features/shortcuts/shortcutFormatter';
  import type { Application } from '../../../bindings';

  type IndexedApp = Application & { id: string };

  let apps = $state<IndexedApp[]>([]);
  let defaultPaths = $state<string[]>([]);
  let isLoading = $state(true);
  let isBrowsing = $state(false);
  let errorMessage = $state<string | null>(null);
  let editingApp = $state<IndexedApp | null>(null);

  let userPaths = $derived(
    settingsService.currentSettings.search.additionalScanPaths ?? []
  );
  let enabledMap = $derived(
    settingsService.currentSettings.search.applicationEnabled ?? {}
  );
  let defaultSet = $derived(new Set(defaultPaths));

  let shortcutsByObjectId = $derived(
    new Map<string, ItemShortcut>(
      shortcutStore.shortcuts.map((s) => [s.objectId, s])
    )
  );

  let pathRows = $derived([
    ...defaultPaths.map((path) => ({ path, readonly: true })),
    ...userPaths.map((path) => ({ path, readonly: false })),
  ]);

  let sortedApps = $derived(
    [...apps].sort((a, b) => a.name.localeCompare(b.name))
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
      defaultPaths = paths;
      apps = withIds(loaded);
    } catch (err) {
      logService.warn(`Failed to load applications: ${err}`);
    } finally {
      isLoading = false;
    }
  });

  async function reloadApps() {
    try {
      apps = withIds(await listApplications(userPaths));
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

  async function handleShortcutSave(detail: { modifier: string; key: string }): Promise<string | true> {
    if (!editingApp) return 'No application selected';
    const shortcut = `${detail.modifier}+${detail.key}`;
    const result = await shortcutService.register(
      editingApp.id,
      editingApp.name,
      'application',
      shortcut,
      editingApp.path,
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
</script>

<div class="app-tab">
  <section class="section">
    <h2 class="section-title">Search Scope</h2>
    <p class="section-description">
      Directories added here will be searched for applications.
    </p>

    <div class="add-row">
      <Button onclick={handleAddDirectory} disabled={isBrowsing}>
        <span class="btn-content">
          <Icon name="plus" size={14} />
          {isBrowsing ? 'Opening…' : 'Add Directory'}
        </span>
      </Button>
    </div>

    {#if errorMessage}
      <div class="error" role="alert">{errorMessage}</div>
    {/if}

    <ul class="path-list">
      {#each pathRows as row (row.path)}
        <li class="path-row" class:path-row-default={row.readonly}>
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
    </ul>
  </section>

  <section class="section">
    <h2 class="section-title">Applications</h2>
    <p class="section-description">
      Assign an alias or hotkey to any app. Disable an app to hide it from search results.
    </p>

    {#if isLoading}
      <div class="empty">Loading applications…</div>
    {:else if sortedApps.length === 0}
      <EmptyState message="No applications found" />
    {:else}
      <div class="app-table" role="table">
        <div class="app-table-head" role="row">
          <span class="col-name" role="columnheader">Name</span>
          <span class="col-alias" role="columnheader">Alias</span>
          <span class="col-hotkey" role="columnheader">Hotkey</span>
          <span class="col-enabled" role="columnheader">Enabled</span>
        </div>

        {#each sortedApps as app (app.id)}
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
              <span class="row-action muted" aria-disabled="true">Add Alias</span>
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
                <button
                  type="button"
                  class="row-action"
                  onclick={() => openShortcutCapture(app)}
                >
                  Record Hotkey
                </button>
              {/if}
            </div>
            <div class="col-enabled" role="cell">
              <Toggle
                checked={isEnabled(app.id)}
                onchange={() => handleToggleEnabled(app)}
              />
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </section>
</div>

{#if editingApp}
  <ShortcutCapture
    onsave={handleShortcutSave}
    oncancel={() => (editingApp = null)}
    ondone={() => (editingApp = null)}
    excludeObjectId={editingApp.id}
  />
{/if}

<style>
  .app-tab {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
  }

  .section {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .section-title {
    margin: 0;
    font-size: var(--font-size-sm);
    font-weight: 600;
    color: var(--text-primary);
  }

  .section-description {
    margin: 0;
    font-size: var(--font-size-xs);
    color: var(--text-secondary);
    line-height: 1.5;
  }

  .add-row {
    align-self: flex-start;
  }

  .btn-content {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
  }

  .error {
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
    border: 1px solid var(--separator);
    border-radius: var(--radius-sm);
    overflow: hidden;
  }

  .path-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border-bottom: 1px solid var(--separator);
  }
  .path-row:last-child { border-bottom: none; }
  .path-row-default { background: var(--bg-secondary); }

  :global(.path-icon) {
    color: var(--text-tertiary);
    flex-shrink: 0;
  }

  .path-text {
    flex: 1;
    min-width: 0;
    font-size: var(--font-size-sm);
    color: var(--text-primary);
    font-family: var(--font-ui);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .default-tag {
    font-size: var(--font-size-2xs);
    font-family: var(--font-ui);
    font-weight: 500;
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .remove-btn {
    padding: var(--space-1);
  }

  .app-table {
    display: flex;
    flex-direction: column;
    border: 1px solid var(--separator);
    border-radius: var(--radius-sm);
    overflow: hidden;
  }

  .app-table-head,
  .app-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 160px 200px 80px;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    border-bottom: 1px solid var(--separator);
  }
  .app-row:last-child { border-bottom: none; }

  .app-table-head {
    background: var(--bg-secondary);
    font-size: var(--font-size-2xs);
    font-weight: 600;
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .col-name {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
  }

  .app-icon {
    width: 20px;
    height: 20px;
    border-radius: var(--radius-xs);
    flex-shrink: 0;
  }

  .app-icon-fallback {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    font-size: var(--font-size-sm);
  }

  .app-name {
    font-size: var(--font-size-sm);
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
    font-size: var(--font-size-xs);
    color: var(--text-tertiary);
    cursor: pointer;
  }

  .row-action:hover:not(.muted) {
    color: var(--accent-primary);
    text-decoration: underline;
  }

  .row-action.muted {
    cursor: default;
    opacity: 0.7;
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
    padding: 2px 6px;
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
