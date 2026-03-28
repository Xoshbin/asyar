<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { snippetStore, type Snippet } from './snippetStore.svelte';
  import { snippetService } from './snippetService';
  import { snippetEditorTrigger } from './snippetUiState';
  import SnippetEditor from './SnippetEditor.svelte';
  import { createPersistence } from '../../lib/persistence/extensionStore';

  const enabledPersistence = createPersistence<boolean>('asyar:snippets:enabled', 'snippets-enabled.dat');
  let permissionGranted = true;
  let snippetsEnabled = enabledPersistence.loadSync(true);
  let editingItem: Snippet | null | undefined = null; // null means not editing, undefined means creating
  let toggleError: string | null = null;

  $: if ($snippetEditorTrigger === 'add') {
    editingItem = undefined;
    snippetEditorTrigger.set(null);
  }

  onMount(async () => {
    // Attempt to sync / get permission on view open
    const result = await snippetService.onViewOpen();
    permissionGranted = result.permissionGranted;
    
    // Make sure initial state matches rust backend
    await snippetService.setEnabled(snippetsEnabled && permissionGranted);
  });

  async function handleRemove(id: string) {
    if (confirm('Delete this snippet?')) {
      snippetStore.remove(id);
      await snippetService.syncToRust();
    }
  }

  async function toggleEnabled() {
    const desiredState = !snippetsEnabled;
    const result = await snippetService.setEnabled(desiredState);
    if (result.ok) {
      snippetsEnabled = desiredState;
      enabledPersistence.save(snippetsEnabled);
      toggleError = null;
    } else {
      toggleError = result.error || 'Failed to enable background expansion';
    }
  }

  async function recheckPermission() {
    const result = await snippetService.onViewOpen();
    permissionGranted = result.permissionGranted;
    if (permissionGranted && snippetsEnabled) {
      const enableResult = await snippetService.setEnabled(true);
      if (!enableResult.ok) {
        toggleError = enableResult.error || 'Failed to enable after permission granted';
      }
    }
  }

</script>

<div class="snippets-view">
  <div class="header">
    <div class="title">✂️ Text snippets</div>
    <div class="header-actions">
      <div class="toggle-container">
        <label class="toggle" class:disabled={!permissionGranted}>
          <span>Background Expansion</span>
          <input type="checkbox" checked={snippetsEnabled && permissionGranted} disabled={!permissionGranted} on:change={toggleEnabled} />
        </label>
        {#if toggleError}
          <div class="toggle-error">{toggleError}</div>
        {/if}
      </div>
      <button class="add-btn" on:click={() => editingItem = undefined}>+ Add</button>
    </div>
  </div>

  {#if !permissionGranted}
    <div class="permission-banner">
      <div class="banner-icon">⚠️</div>
      <div class="banner-content">
        <p>Background expansion requires Accessibility permission. Open System Settings → Privacy & Security → Accessibility and add Asyar. If running in development, add the binary at: src-tauri/target/debug/asyar</p>
        <button class="btn banner-btn" on:click={() => snippetService.openAccessibilityPreferences()}>Open System Settings</button>
        <button class="btn banner-btn" on:click={recheckPermission}>Re-check Permission</button>
      </div>
    </div>
  {/if}

  <div class="list">
    {#if snippetStore.snippets.length === 0}
      <div class="empty-state">
        <div class="empty-icon">✂️</div>
        <p class="empty-title">No snippets yet</p>
        <p class="empty-hint">Create your first snippet to expand text automatically.</p>
        <button class="btn primary add-first-btn" on:click={() => editingItem = undefined}>Add your first snippet</button>
      </div>
    {:else}
      {#each snippetStore.snippets as s (s.id)}
        <div class="snippet-row">
          <div class="info">
            <span class="name">{s.name}</span>
            <div class="meta">
              <span class="chip">{s.keyword}</span>
              <span class="expansion-preview">{s.expansion}</span>
            </div>
          </div>
          <div class="actions">
            <button class="edit-btn" on:click={() => editingItem = s} title="Edit snippet">
              Edit
            </button>
            <button class="remove-btn" on:click={() => handleRemove(s.id)} title="Delete snippet">
              ✕
            </button>
          </div>
        </div>
      {/each}
    {/if}
  </div>

  {#if editingItem !== null}
    <SnippetEditor snippet={editingItem} on:close={() => editingItem = null} />
  {/if}
</div>

<style>
  .snippets-view {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--bg-primary);
    color: var(--text-primary);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  }

  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 16px 8px;
    border-bottom: 1px solid var(--border-color);
    flex-shrink: 0;
  }

  .title {
    font-size: 13px;
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .toggle-container {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
  }

  .toggle-error {
    font-size: 10px;
    color: var(--accent-danger);
    margin-top: 4px;
    max-width: 250px;
    text-align: right;
  }

  .toggle {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: var(--text-secondary);
    cursor: pointer;
  }
  .toggle.disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .add-btn {
    background: transparent;
    color: var(--accent-primary);
    border: none;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    padding: 2px 6px;
    border-radius: 4px;
    transition: background 0.1s;
  }

  .add-btn:hover {
    background: var(--bg-hover);
  }

  .permission-banner {
    display: flex;
    gap: 12px;
    margin: 12px 16px 0;
    padding: 12px;
    background: color-mix(in srgb, var(--accent-warning) 10%, transparent);
    border: 1px solid var(--accent-warning);
    border-radius: var(--border-radius-md);
    align-items: flex-start;
  }

  .banner-icon {
    font-size: 16px;
    margin-top: 2px;
  }

  .banner-content p {
    margin: 0 0 10px;
    font-size: 12px;
    color: var(--text-primary);
    line-height: 1.4;
  }

  .banner-btn {
    font-size: 11px;
    padding: 4px 10px;
    background: var(--bg-secondary);
    color: var(--text-primary);
  }

  .list {
    flex: 1;
    overflow-y: auto;
    padding: 4px 0;
    min-height: 0;
  }

  /* Empty state */
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 60px 24px;
    text-align: center;
    gap: 8px;
  }

  .empty-icon {
    font-size: 32px;
    margin-bottom: 4px;
    opacity: 0.4;
  }

  .empty-title {
    margin: 0;
    font-size: 13px;
    font-weight: 500;
    color: var(--text-secondary);
  }

  .empty-hint {
    margin: 0;
    font-size: 12px;
    color: var(--text-tertiary);
    line-height: 1.5;
  }
  
  .add-first-btn {
    margin-top: 10px;
    padding: 6px 14px;
    background: var(--accent-primary);
    color: white;
    font-size: 13px;
    font-weight: 500;
    border: none;
    border-radius: var(--border-radius-md);
    cursor: pointer;
  }

  /* Snippet rows */
  .snippet-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 10px 16px;
    border-bottom: 1px solid var(--separator);
    transition: background 0.1s;
  }

  .snippet-row:last-child {
    border-bottom: none;
  }

  .snippet-row:hover {
    background: var(--bg-hover);
  }

  .snippet-row:hover .actions {
    opacity: 1;
  }

  .info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .name {
    font-size: 13px;
    font-weight: 500;
    color: var(--text-primary);
  }

  .meta {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .chip {
    font-size: 11px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: 4px;
    padding: 1px 6px;
    color: var(--accent-primary);
    flex-shrink: 0;
  }

  .expansion-preview {
    font-size: 12px;
    color: var(--text-tertiary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    display: inline-block;
    max-width: 300px;
  }

  /* Actions */
  .actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
    opacity: 0.2;
    transition: opacity 0.15s;
  }

  .edit-btn {
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    color: var(--text-secondary);
    padding: 4px 10px;
    border-radius: var(--border-radius-sm);
    font-size: 11px;
    cursor: pointer;
  }

  .edit-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .remove-btn {
    background: transparent;
    border: none;
    color: var(--accent-danger);
    width: 24px;
    height: 24px;
    border-radius: var(--border-radius-sm);
    font-size: 12px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .remove-btn:hover {
    background: color-mix(in srgb, var(--accent-danger) 12%, transparent);
  }
</style>
