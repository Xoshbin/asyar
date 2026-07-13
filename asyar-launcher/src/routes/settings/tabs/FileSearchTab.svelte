<script lang="ts">
  import { Input } from '../../../components';
  import { listen, type UnlistenFn } from '@tauri-apps/api/event';
  import { open } from '@tauri-apps/plugin-dialog';
  import { Button, Icon, Toggle, Badge } from '../../../components';
  import { settingsService } from '../../../services/settings/settingsService.svelte';
  import { setFocusLock } from '../../../lib/ipc/commands';
  import { fileIndexStatus, fileIndexRebuild } from '../../../lib/ipc/fileSearchCommands';
  import { logService } from '../../../services/log/logService';
  import type { IndexStatus } from '../../../bindings';
  import { canAddRoot, canAddExcludePattern } from './fileSearchTab.helpers';

  let roots = $derived(settingsService.currentSettings.fileSearch.includeRoots ?? []);
  let excludePatterns = $derived(settingsService.currentSettings.fileSearch.excludePatterns ?? []);
  let enabled = $derived(settingsService.currentSettings.fileSearch.enabled);

  let isBrowsing = $state(false);
  let newExcludePattern = $state('');
  let errorMessage = $state<string | null>(null);
  let status = $state<IndexStatus | null>(null);
  let rebuilding = $state(false);

  const STATE_LABELS: Record<string, string> = {
    disabled: 'Disabled',
    building: 'Building…',
    ready: 'Ready',
    rescanning: 'Rescanning…',
    'cap-reached': 'Index cap reached',
  };

  async function refreshStatus() {
    status = await fileIndexStatus();
  }

  $effect(() => {
    void refreshStatus();
    let unlisten: UnlistenFn | undefined;
    listen<IndexStatus>('asyar:file-index-status', (e) => {
      status = e.payload;
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  });

  async function persistFileSearch(
    patch: Partial<{
      enabled: boolean;
      includeRoots: string[];
      excludePatterns: string[];
      indexHidden: boolean;
    }>,
  ) {
    const ok = await settingsService.updateSettings('fileSearch', patch);
    if (!ok) {
      errorMessage = 'Failed to save file search settings';
      return;
    }
    errorMessage = null;
  }

  async function handleToggleEnabled() {
    await persistFileSearch({ enabled: !enabled });
  }

  async function handleAddRoot() {
    if (isBrowsing) return;
    isBrowsing = true;
    errorMessage = null;
    try {
      await setFocusLock(true);
      const picked = await open({ directory: true, multiple: false, title: 'Add Search Root' });
      if (!picked || typeof picked !== 'string') return;
      if (!canAddRoot(picked, roots)) {
        errorMessage = `${picked} is already in the list`;
        return;
      }
      await persistFileSearch({ includeRoots: [...roots, picked] });
    } catch (err) {
      logService.warn(`Directory picker failed: ${err}`);
      errorMessage = 'Could not open directory picker';
    } finally {
      await setFocusLock(false);
      isBrowsing = false;
    }
  }

  async function handleRemoveRoot(path: string) {
    await persistFileSearch({ includeRoots: roots.filter((p) => p !== path) });
  }

  async function handleAddExcludePattern() {
    const pattern = newExcludePattern.trim();
    if (!canAddExcludePattern(pattern, excludePatterns)) {
      errorMessage = pattern ? `"${pattern}" is already excluded` : null;
      return;
    }
    errorMessage = null;
    await persistFileSearch({ excludePatterns: [...excludePatterns, pattern] });
    newExcludePattern = '';
  }

  async function handleRemoveExcludePattern(pattern: string) {
    await persistFileSearch({ excludePatterns: excludePatterns.filter((p) => p !== pattern) });
  }

  // The command itself resolves as soon as the background scan is
  // *spawned*, not when it's done — the actual duration is reflected by
  // `status.state` transitioning through `rescanning` (set synchronously,
  // before the command returns) back to `ready`. `rebuilding` only guards
  // the brief window between the click and that first status event landing.
  let isRebuilding = $derived(rebuilding || status?.state === 'rescanning');

  async function handleRebuild() {
    if (isRebuilding) return;
    rebuilding = true;
    try {
      await fileIndexRebuild();
    } finally {
      rebuilding = false;
    }
  }
</script>

<div class="file-search-tab">
  <section class="section">
    <div class="section-header-row">
      <div>
        <h2 class="section-title">File Search</h2>
        <p class="section-description">
          Search files across your home folder. Indexing runs in the background and excludes caches,
          dependency folders, and system directories by default.
        </p>
      </div>
      <Toggle checked={enabled} onchange={handleToggleEnabled} />
    </div>
  </section>

  <section class="section">
    <h2 class="section-title">Index Status</h2>
    {#if status}
      <div class="status-card">
        <Badge text={STATE_LABELS[status.state] ?? status.state} variant="default" />
        <span class="text-caption">{status.entryCount.toLocaleString()} files indexed</span>
        {#if status.lastScanMs > 0}
          <span class="text-caption opacity-70">last scan {status.lastScanMs}ms</span>
        {/if}
        {#if status.snapshotLoaded}
          <span class="text-caption opacity-70">restored from snapshot</span>
        {/if}
        <Button onclick={handleRebuild} disabled={isRebuilding}>
          {isRebuilding ? 'Rebuilding…' : 'Rebuild Index'}
        </Button>
      </div>
      {#if status.capReached}
        <div class="warning" role="alert">
          The index hit its size cap — some files may not be searchable. Add exclude patterns to
          narrow the scan, or reduce your search roots.
        </div>
      {/if}
    {/if}
  </section>

  <section class="section">
    <h2 class="section-title">Search Roots</h2>
    <p class="section-description">
      Empty ⇒ your entire home folder. Add specific directories to narrow the scope.
    </p>

    <div class="add-row">
      <Button onclick={handleAddRoot} disabled={isBrowsing}>
        <span class="btn-content">
          <Icon name="plus" size={14} />
          {isBrowsing ? 'Opening…' : 'Add Root'}
        </span>
      </Button>
    </div>

    {#if errorMessage}
      <div class="error" role="alert">{errorMessage}</div>
    {/if}

    {#if roots.length > 0}
      <ul class="path-list">
        {#each roots as path (path)}
          <li class="path-row">
            <Icon name="folder" size={14} class="path-icon" />
            <span class="path-text" title={path}>{path}</span>
            <button
              type="button"
              class="btn btn-danger remove-btn"
              aria-label="Remove {path}"
              onclick={() => handleRemoveRoot(path)}
            >
              <Icon name="trash" size={14} />
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <section class="section">
    <h2 class="section-title">Exclude Patterns</h2>
    <p class="section-description">
      Layered on top of the built-in exclusions (node_modules, .git, caches, etc).
    </p>

    <div class="add-row exclude-add-row">
      <Input
        unstyled
        textIntent="exact"
        type="text"
        class="exclude-input"
        placeholder="e.g. *.tmp"
        bind:value={newExcludePattern}
        onkeydown={(e) => e.key === 'Enter' && handleAddExcludePattern()}
      />
      <Button onclick={handleAddExcludePattern}>Add</Button>
    </div>

    {#if excludePatterns.length > 0}
      <ul class="path-list">
        {#each excludePatterns as pattern (pattern)}
          <li class="path-row">
            <Icon name="filter" size={14} class="path-icon" />
            <span class="path-text text-mono" title={pattern}>{pattern}</span>
            <button
              type="button"
              class="btn btn-danger remove-btn"
              aria-label="Remove {pattern}"
              onclick={() => handleRemoveExcludePattern(pattern)}
            >
              <Icon name="trash" size={14} />
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </section>
</div>

<style>
  .file-search-tab {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
  }

  .section {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .section-header-row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-4);
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

  .status-card {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3);
    border: 1px solid var(--separator);
    border-radius: var(--radius-sm);
    flex-wrap: wrap;
  }

  .warning {
    padding: var(--space-2) var(--space-3);
    background: color-mix(in srgb, var(--accent-warning, orange) 10%, transparent);
    border-radius: var(--radius-sm);
    font-size: var(--font-size-xs);
    color: var(--text-primary);
  }

  .add-row {
    align-self: flex-start;
  }

  .exclude-add-row {
    display: flex;
    gap: var(--space-2);
    align-self: stretch;
  }

  :global(.exclude-input) {
    flex: 1;
    min-width: 0;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--separator);
    border-radius: var(--radius-sm);
    background: var(--bg-secondary);
    color: var(--text-primary);
    font-size: var(--font-size-sm);
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
  .path-row:last-child {
    border-bottom: none;
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
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .remove-btn {
    padding: var(--space-1);
  }
</style>
