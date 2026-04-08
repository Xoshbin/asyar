<script lang="ts">
  import { shortcutStore, type ItemShortcut } from './shortcutStore.svelte';
  import { toDisplayString } from './shortcutFormatter';
  import { shortcutService } from './shortcutService';
  import ShortcutCapture from './ShortcutCapture.svelte';
  import { EmptyState, ListItem, Badge, KeyboardHint, ListItemActions } from '../../components';
  import { feedbackService } from '../../services/feedback/feedbackService.svelte';

  let editingItem = $state<any | null>(null);

  async function handleRemove(id: string, name: string) {
    const confirmed = await feedbackService.confirmAlert({
      title: 'Remove shortcut',
      message: `Remove the shortcut for "${name}"?`,
      confirmText: 'Remove',
      variant: 'danger',
    });
    if (!confirmed) return;
    await shortcutService.unregister(id);
  }

  async function handleSave(detail: { modifier: string; key: string }): Promise<string | true> {
    if (!editingItem) return 'No item selected';

    const shortcut = `${detail.modifier}+${detail.key}`;
    const result = await shortcutService.register(
      editingItem.objectId,
      editingItem.itemName,
      editingItem.itemType,
      shortcut,
      editingItem.itemPath
    );

    if (!result.ok) {
      const reason = result.conflict?.itemName ?? 'Unsupported key or OS error';
      return `Could not assign: ${reason}`;
    }

    return true;
  }
</script>

<div class="view-container">

  <div class="list custom-scrollbar">
    {#if shortcutStore.shortcuts.length === 0}
      <EmptyState 
        message="No shortcuts configured yet" 
        description='Use ⌘K on any search result and choose "Assign Shortcut" to add one.'
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
                <KeyboardHint keys={toDisplayString(s.shortcut)} />
              </button>
              <ListItemActions>
                <button class="btn-danger h-7 w-7 flex items-center justify-center p-0" onclick={() => handleRemove(s.objectId, s.itemName)} title="Remove shortcut">✕</button>
              </ListItemActions>
            </div>
          {/snippet}
        </ListItem>
      {/each}
    {/if}
  </div>

  {#if editingItem}
    <ShortcutCapture onsave={handleSave} oncancel={() => editingItem = null} ondone={() => editingItem = null} excludeObjectId={editingItem?.objectId} />
  {/if}
</div>

<style>
  .kbd-btn {
    background: transparent;
    border: none;
    padding: 0;
    cursor: pointer;
  }


  .list { flex: 1; overflow-y: auto; min-height: 0; }
</style>

