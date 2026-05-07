<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { shortcutStore, type ItemShortcut } from './shortcutStore.svelte';
  import { shortcutService } from './shortcutService';
  import ShortcutCapture from './ShortcutCapture.svelte';
  import { EmptyState, LauncherListRow } from '../../components';
  import { feedbackService } from '../../services/feedback/feedbackService.svelte';
  import { actionService } from '../../services/action/actionService.svelte';
  import { searchStores } from '../../services/search/stores/search.svelte';
  import { ActionContext } from 'asyar-sdk/contracts';
  import { shiftIndex } from '../../lib/listSelection.svelte';

  let editingItem = $state<ItemShortcut | null>(null);
  let selectedId = $state<string | null>(null);

  const filteredShortcuts = $derived.by(() => {
    const all = shortcutStore.shortcuts;
    const q = searchStores.query.trim().toLowerCase();
    if (!q) return all;
    return all.filter(s =>
      s.itemName.toLowerCase().includes(q) ||
      s.itemType.toLowerCase().includes(q) ||
      (s.itemPath?.toLowerCase().includes(q) ?? false)
    );
  });

  $effect(() => {
    if (filteredShortcuts.length === 0) {
      selectedId = null;
      return;
    }
    if (!selectedId || !filteredShortcuts.some(s => s.id === selectedId)) {
      selectedId = filteredShortcuts[0].id;
    }
  });

  $effect(() => {
    const s = filteredShortcuts.find(x => x.id === selectedId);
    if (!s) {
      actionService.unregisterAction('shortcuts:remove');
      actionService.unregisterAction('shortcuts:change');
      return;
    }

    actionService.registerAction({
      id: 'shortcuts:change',
      title: 'Change',
      icon: 'icon:pencil',
      extensionId: 'shortcuts',
      category: 'Shortcuts',
      context: ActionContext.EXTENSION_VIEW,
      execute: async () => {
        editingItem = s;
      },
    });

    actionService.registerAction({
      id: 'shortcuts:remove',
      title: 'Remove',
      icon: 'icon:trash',
      extensionId: 'shortcuts',
      category: 'Shortcuts',
      destructive: true,
      context: ActionContext.EXTENSION_VIEW,
      execute: async () => {
        await handleRemove(s.objectId, s.itemName);
      },
    });

    return () => {
      actionService.unregisterAction('shortcuts:remove');
      actionService.unregisterAction('shortcuts:change');
    };
  });

  onDestroy(() => {
    actionService.unregisterAction('shortcuts:remove');
    actionService.unregisterAction('shortcuts:change');
  });

  function handleKeydown(e: KeyboardEvent) {
    if (editingItem || filteredShortcuts.length === 0) return;

    const idx = filteredShortcuts.findIndex(s => s.id === selectedId);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = shiftIndex(idx, filteredShortcuts.length, e.key === 'ArrowDown' ? 'down' : 'up');
      selectedId = filteredShortcuts[next].id;
    } else if (e.key === 'Enter') {
      const s = filteredShortcuts.find(x => x.id === selectedId);
      if (s) editingItem = s;
    }
  }

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
      editingItem.itemPath,
      editingItem.itemIcon,
    );

    if (!result.ok) {
      const reason = result.conflict?.itemName ?? 'Unsupported key or OS error';
      return `Could not assign: ${reason}`;
    }

    return true;
  }

  onMount(() => {
    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  });
</script>

<div class="view-container">

  <div class="list custom-scrollbar p-2">
    {#if shortcutStore.shortcuts.length === 0}
      <EmptyState
        message="No shortcuts configured yet"
        description='Use ⌘K on any search result and choose "Assign Shortcut" to add one.'
      >
        {#snippet icon()}
          <span class="text-4xl opacity-50">⌨️</span>
        {/snippet}
      </EmptyState>
    {:else if filteredShortcuts.length === 0}
      <EmptyState
        message="No matching shortcuts"
        description={`Nothing matches "${searchStores.query}".`}
      >
        {#snippet icon()}
          <span class="text-4xl opacity-50">🔍</span>
        {/snippet}
      </EmptyState>
    {:else}
      {#each filteredShortcuts as s (s.id)}
        <LauncherListRow
          title={s.itemName}
          icon={s.itemIcon ?? (s.itemType === 'application' ? '📱' : '⚡')}
          shortcut={s.shortcut}
          shortcutPlacement="trailing"
          selected={selectedId === s.id}
          onclick={() => { selectedId = s.id; }}
          ondblclick={() => { editingItem = s; }}
        />
      {/each}
    {/if}
  </div>

  {#if editingItem}
    <ShortcutCapture onsave={handleSave} oncancel={() => editingItem = null} ondone={() => editingItem = null} excludeObjectId={editingItem?.objectId} />
  {/if}
</div>

<style>
  .list { flex: 1; overflow-y: auto; min-height: 0; }
</style>
