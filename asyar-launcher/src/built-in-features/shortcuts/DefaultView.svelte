<script lang="ts">
  import { shortcutStore, type ItemShortcut } from './shortcutStore.svelte';
  import { toDisplayString } from './shortcutFormatter';
  import { shortcutService } from './shortcutService';
  import ShortcutCapture from './ShortcutCapture.svelte';

  let editingItem: any | null = null;

  async function handleRemove(id: string) {
    await shortcutService.unregister(id);
  }

  async function handleCapture(newShortcut: string) {
    if (editingItem) {
      await shortcutService.register(
        editingItem.objectId,
        editingItem.itemName,
        editingItem.itemType,
        newShortcut,
        editingItem.itemPath
      );
    }
    editingItem = null;
  }
</script>

<div class="shortcuts-view">
  <div class="header">
    <div class="title">⌨️ Global Shortcuts</div>
    <span class="count">{shortcutStore.shortcuts.length} shortcut{shortcutStore.shortcuts.length !== 1 ? 's' : ''}</span>
  </div>

  <div class="list">
    {#if shortcutStore.shortcuts.length === 0}
      <div class="empty-state">
        <div class="empty-icon">⌨️</div>
        <p class="empty-title">No shortcuts configured yet</p>
        <p class="empty-hint">Use <kbd>⌘K</kbd> on any search result and choose "Assign Shortcut" to add one.</p>
      </div>
    {:else}
      {#each shortcutStore.shortcuts as s (s.id)}
        <div class="shortcut-row">
          <div class="item-icon">
            {#if s.itemType === 'application'}📱{:else if s.itemType === 'command'}⚡{:else}🔗{/if}
          </div>
          <div class="info">
            <span class="name">{s.itemName}</span>
            <span class="meta">
              <span class="type-badge">{s.itemType}</span>
              {#if s.itemPath}
                <span class="path">{s.itemPath}</span>
              {/if}
            </span>
          </div>
          <div class="actions">
            <button class="badge-btn" on:click={() => editingItem = s} title="Reassign shortcut">
              <kbd class="shortcut-badge">{toDisplayString(s.shortcut)}</kbd>
            </button>
            <button class="remove-btn" on:click={() => handleRemove(s.objectId)} title="Remove shortcut">
              ✕
            </button>
          </div>
        </div>
      {/each}
    {/if}
  </div>

  {#if editingItem}
    <ShortcutCapture events={{ capture: handleCapture, cancel: () => editingItem = null }} />
  {/if}
</div>

<style>
  .shortcuts-view {
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

  .count {
    font-size: 11px;
    color: var(--text-tertiary);
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

  .empty-hint kbd {
    font-size: 11px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: 3px;
    padding: 1px 5px;
    font-family: inherit;
    color: var(--text-secondary);
  }

  /* Shortcut rows */
  .shortcut-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 16px;
    border-bottom: 1px solid var(--separator);
    transition: background 0.1s;
  }

  .shortcut-row:last-child {
    border-bottom: none;
  }

  .shortcut-row:hover {
    background: var(--bg-hover);
  }

  .shortcut-row:hover .remove-btn {
    opacity: 1;
  }

  .item-icon {
    font-size: 16px;
    flex-shrink: 0;
    width: 24px;
    text-align: center;
  }

  .info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .name {
    font-size: 13px;
    font-weight: 500;
    color: var(--text-primary);
  }

  .meta {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .type-badge {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--text-tertiary);
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: 3px;
    padding: 1px 5px;
  }

  .path {
    font-size: 11px;
    color: var(--text-tertiary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 260px;
  }

  /* Actions */
  .actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }

  .badge-btn {
    background: transparent;
    border: none;
    cursor: pointer;
    padding: 0;
  }

  .shortcut-badge {
    display: inline-block;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    color: var(--accent-primary);
    padding: 4px 10px;
    border-radius: var(--border-radius-md);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 13px;
    font-weight: 500;
    letter-spacing: 0.5px;
    transition: background 0.1s;
    cursor: pointer;
  }

  .badge-btn:hover .shortcut-badge {
    background: var(--bg-hover);
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
    opacity: 0;
    transition: opacity 0.15s, background 0.1s;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .remove-btn:hover {
    background: color-mix(in srgb, var(--accent-danger) 12%, transparent);
  }
</style>
