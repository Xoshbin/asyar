<script lang="ts">
  import { onMount } from 'svelte';
  import { Button, Icon, EmptyState } from '../../../components';
  import {
    scriptsListDirectories,
    scriptsPickDirectory,
    scriptsAddDirectory,
    scriptsRemoveDirectory,
  } from '../../../lib/ipc/commands';
  import { logService } from '../../../services/log/logService';

  let directories = $state<string[]>([]);
  let isLoading = $state(true);
  let isBrowsing = $state(false);
  let errorMessage = $state<string | null>(null);

  async function fetchDirectories() {
    try {
      directories = await scriptsListDirectories();
    } catch (err) {
      logService.warn(`Failed to list script directories: ${err}`);
    }
  }

  onMount(async () => {
    try {
      await fetchDirectories();
    } finally {
      isLoading = false;
    }
  });

  async function handleAddDirectory() {
    if (isBrowsing) return;
    isBrowsing = true;
    errorMessage = null;
    try {
      const picked = await scriptsPickDirectory();
      if (!picked) return;

      if (directories.includes(picked)) {
        errorMessage = `${picked} is already in the list`;
        return;
      }

      await scriptsAddDirectory(picked);
      await fetchDirectories();
    } catch (err) {
      logService.warn(`Script directory picker failed: ${err}`);
      errorMessage = 'Could not add directory';
    } finally {
      isBrowsing = false;
    }
  }

  async function handleRemoveDirectory(path: string) {
    try {
      await scriptsRemoveDirectory(path);
      await fetchDirectories();
    } catch (err) {
      logService.warn(`Failed to remove script directory: ${err}`);
      errorMessage = 'Could not remove directory';
    }
  }
</script>

<div class="scripts-tab">
  <section class="section">
    <h2 class="section-title">Script Directories</h2>
    <p class="section-description">
      Directories added here will be watched for executable scripts. Scripts are
      discovered automatically — no restart required.
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

    {#if isLoading}
      <div class="empty">Loading…</div>
    {:else if directories.length === 0}
      <EmptyState message="No script directories added yet" />
    {:else}
      <ul class="path-list">
        {#each directories as path (path)}
          <li class="path-row">
            <Icon name="dev-tools" size={14} class="path-icon" />
            <span class="path-text" title={path}>{path}</span>
            <button
              type="button"
              class="btn btn-danger remove-btn"
              aria-label="Remove {path}"
              onclick={() => handleRemoveDirectory(path)}
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
  .scripts-tab {
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
    font-family: var(--font-ui);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .remove-btn {
    padding: var(--space-1);
  }

  .empty {
    padding: var(--space-4);
    text-align: center;
    color: var(--text-tertiary);
    font-size: var(--font-size-sm);
  }
</style>
