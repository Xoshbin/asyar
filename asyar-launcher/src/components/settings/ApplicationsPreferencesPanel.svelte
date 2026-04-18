<script lang="ts">
  import { onMount } from 'svelte';
  import { open } from '@tauri-apps/plugin-dialog';
  import { emit } from '@tauri-apps/api/event';
  import Icon from '../base/Icon.svelte';
  import Button from '../base/Button.svelte';
  import { settingsService } from '../../services/settings/settingsService.svelte';
  import { getDefaultAppScanPaths, normalizeScanPath, setFocusLock } from '../../lib/ipc/commands';
  import { logService } from '../../services/log/logService';

  let defaultPaths = $state<string[]>([]);
  let isBrowsing = $state(false);
  let errorMessage = $state<string | null>(null);

  let userPaths = $derived(
    settingsService.currentSettings.search.additionalScanPaths ?? []
  );
  let defaultSet = $derived(new Set(defaultPaths));

  onMount(async () => {
    try {
      defaultPaths = await getDefaultAppScanPaths();
    } catch (err) {
      logService.warn(`Failed to load default scan paths: ${err}`);
      defaultPaths = [];
    }
  });

  async function persist(paths: string[]) {
    const ok = await settingsService.updateSettings('search', {
      additionalScanPaths: paths,
    });
    if (!ok) {
      errorMessage = 'Failed to save directory list';
      return;
    }
    errorMessage = null;
    await emit('asyar:app-scan-paths-changed', { additionalScanPaths: paths });
  }

  async function handleAdd() {
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

      await persist([...userPaths, normalized]);
    } catch (err) {
      logService.warn(`Directory picker failed: ${err}`);
      errorMessage = 'Could not open directory picker';
    } finally {
      await setFocusLock(false);
      isBrowsing = false;
    }
  }

  async function handleRemove(path: string) {
    await persist(userPaths.filter((p) => p !== path));
  }

  let rows = $derived([
    ...defaultPaths.map((path) => ({ path, readonly: true })),
    ...userPaths.map((path) => ({ path, readonly: false })),
  ]);
</script>

<div class="panel">
  <div class="section-header">Search Scope</div>
  <p class="section-description">
    Directories added here will be searched for applications.
  </p>

  <div class="add-row">
    <Button onclick={handleAdd} disabled={isBrowsing}>
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
    {#each rows as row (row.path)}
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
            onclick={() => handleRemove(row.path)}
          >
            <Icon name="trash" size={14} />
          </button>
        {/if}
      </li>
    {/each}
  </ul>
</div>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
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
</style>
