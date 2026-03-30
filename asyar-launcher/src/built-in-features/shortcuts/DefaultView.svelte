<script lang="ts">
  import { shortcutStore, type ItemShortcut } from './shortcutStore.svelte';
  import { toDisplayString } from './shortcutFormatter';
  import { shortcutService } from './shortcutService';
  import ShortcutCapture from './ShortcutCapture.svelte';
  import { EmptyState, ListItem, Badge } from '../../components';

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
    <div class="flex items-center gap-2">Global Shortcuts</div>
    <span class="text-caption">{shortcutStore.shortcuts.length} shortcut{shortcutStore.shortcuts.length !== 1 ? 's' : ''}</span>
  </div>

  <div class="list custom-scrollbar">
    {#if shortcutStore.shortcuts.length === 0}
      <EmptyState 
        message="No shortcuts configured yet" 
        description='Use <kbd class="bg-[var(--bg-tertiary)] px-1.5 py-0.5 rounded border border-[var(--separator)]">⌘K</kbd> on any search result and choose "Assign Shortcut" to add one.'
      >
        {#snippet icon()}
          <span class="text-4xl opacity-50">⌨️</span>
        {/snippet}
      </EmptyState>
    {:else}
      {#each shortcutStore.shortcuts as s (s.id)}
        <ListItem 
          title={s.itemName}
          onclick={() => {}}
        >
          {#snippet leading()}
             <div class="w-8 h-8 rounded-lg bg-[var(--bg-tertiary)] flex items-center justify-center text-lg">
                {#if s.itemType === 'application'}📱{:else if s.itemType === 'command'}⚡{:else}🔗{/if}
             </div>
          {/snippet}
          {#snippet subtitle()}
            <div class="flex items-center gap-2">
              <Badge text={s.itemType} variant="default" mono />
              {#if s.itemPath}
                <span class="truncate max-w-[260px] opacity-60">{s.itemPath}</span>
              {/if}
            </div>
          {/snippet}
          {#snippet trailing()}
            <div class="flex items-center gap-2">
              <button class="kbd-btn" onclick={() => editingItem = s} title="Reassign shortcut">
                <kbd class="shortcut-display">{toDisplayString(s.shortcut)}</kbd>
              </button>
              <button class="btn-danger remove-btn" onclick={() => handleRemove(s.objectId)} title="Remove shortcut">
                ✕
              </button>
            </div>
          {/snippet}
        </ListItem>
      {/each}
    {/if}
  </div>

  {#if editingItem}
    <ShortcutCapture oncapture={handleCapture} oncancel={() => editingItem = null} excludeObjectId={editingItem?.objectId} />
  {/if}
</div>

<style>
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
  
  /* Target the list-row child of ListItem */
  :global(.list-row:hover) .remove-btn {
    opacity: 1;
  }

  .list { flex: 1; overflow-y: auto; min-height: 0; }
</style>

