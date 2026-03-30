<script lang="ts">
  import { shortcutStore, type ItemShortcut } from './shortcutStore.svelte';
  import { toDisplayString } from './shortcutFormatter';
  import { shortcutService } from './shortcutService';
  import ShortcutCapture from './ShortcutCapture.svelte';
  import Icon from '../../components/base/Icon.svelte';

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

<div class="view-container">
  <div class="view-header">
    <div class="flex items-center gap-2"><Icon name="keyboard" size={16} /> Global Shortcuts</div>
    <span class="text-caption">{shortcutStore.shortcuts.length} shortcut{shortcutStore.shortcuts.length !== 1 ? 's' : ''}</span>
  </div>

  <div class="list">
    {#if shortcutStore.shortcuts.length === 0}
      <div class="empty-state">
        <Icon name="keyboard" size={48} />
        <p class="text-body font-medium">No shortcuts configured yet</p>
        <p class="text-caption">Use <kbd>⌘K</kbd> on any search result and choose "Assign Shortcut" to add one.</p>
      </div>
    {:else}
      {#each shortcutStore.shortcuts as s (s.id)}
        <div class="list-row">
          <div class="w-6 text-center text-lg">{#if s.itemType === 'application'}📱{:else if s.itemType === 'command'}⚡{:else}🔗{/if}</div>
          <div class="flex-1 min-w-0 flex flex-col gap-0.5">
            <span class="text-body font-medium">{s.itemName}</span>
            <div class="flex items-center gap-2 overflow-hidden">
              <span class="text-mono type-badge">{s.itemType}</span>
              {#if s.itemPath}
                <span class="text-caption truncate max-w-[260px]">{s.itemPath}</span>
              {/if}
            </div>
          </div>
          <div class="flex items-center gap-2">
            <button class="kbd-btn" onclick={() => editingItem = s} title="Reassign shortcut">
              <kbd class="shortcut-display">{toDisplayString(s.shortcut)}</kbd>
            </button>
            <button class="btn-danger remove-btn" onclick={() => handleRemove(s.objectId)} title="Remove shortcut">
              ✕
            </button>
          </div>
        </div>
      {/each}
    {/if}
  </div>

  {#if editingItem}
    <ShortcutCapture oncapture={handleCapture} oncancel={() => editingItem = null} excludeObjectId={editingItem?.objectId} />
  {/if}
</div>

<style>
  .type-badge {
    background: var(--bg-tertiary);
    padding: 1px 5px;
    border-radius: var(--radius-xs);
    border: 1px solid var(--border-color);
  }
  .kbd-btn {
    background: transparent;
    border: none;
    padding: 0;
    cursor: pointer;
  }
  .shortcut-display {
    color: var(--accent-primary);
    font-size: 13px;
    height: auto;
    min-width: auto;
    padding: 4px 10px;
    border-radius: var(--radius-md);
  }
  .remove-btn {
    padding: 8px;
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    transition: opacity var(--transition-fast);
  }
  .list-row:hover .remove-btn { opacity: 1; }
  .list { flex: 1; overflow-y: auto; min-height: 0; }
</style>
