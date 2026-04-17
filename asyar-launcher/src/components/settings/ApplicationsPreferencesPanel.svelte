<script lang="ts">
  import { onMount } from 'svelte';
  import { open } from '@tauri-apps/plugin-dialog';
  import { emit } from '@tauri-apps/api/event';
  import Icon from '../base/Icon.svelte';
  import { settingsService } from '../../services/settings/settingsService.svelte';
  import { getDefaultAppScanPaths, setFocusLock } from '../../lib/ipc/commands';
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

  function normalizePath(path: string): string {
    const trimmed = path.trim();
    if (trimmed.length <= 1) return trimmed;
    return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
  }

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

      const normalized = normalizePath(picked);
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
      logService.error(`Directory picker failed: ${err}`);
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

  <button
    type="button"
    class="add-btn"
    onclick={handleAdd}
    disabled={isBrowsing}
  >
    <Icon name="plus" size={14} />
    <span>{isBrowsing ? 'Opening…' : 'Add Directory'}</span>
  </button>

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
            class="remove-btn"
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

  .section-header {
    font-size: var(--font-size-xs);
    font-weight: 600;
    font-family: var(--font-ui);
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .section-description {
    margin: 0;
    font-size: var(--font-size-xs);
    color: var(--text-secondary);
    line-height: 1.5;
  }

  .add-btn {
    align-self: flex-start;
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    background: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    font-size: var(--font-size-xs);
    font-family: var(--font-ui);
    font-weight: 500;
    color: var(--text-primary);
    cursor: pointer;
    transition: background var(--transition-fast);
  }

  .add-btn:hover:not(:disabled) {
    background: var(--bg-hover);
  }

  .add-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
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

  .path-row:last-child {
    border-bottom: none;
  }

  .path-row-default {
    background: var(--bg-secondary);
  }

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
    font-size: 10px;
    font-family: var(--font-ui);
    font-weight: 500;
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .remove-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-1);
    background: transparent;
    border: none;
    border-radius: var(--radius-xs);
    color: var(--text-tertiary);
    cursor: pointer;
    transition: color var(--transition-fast), background var(--transition-fast);
  }

  .remove-btn:hover {
    color: var(--accent-danger);
    background: color-mix(in srgb, var(--accent-danger) 10%, transparent);
  }
</style>
