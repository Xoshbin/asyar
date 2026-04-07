<script lang="ts">
  import { tick } from 'svelte';
  import { portalStore, type Portal } from './portalStore.svelte';
  import { syncPortalToIndex, removePortalFromIndex, portalsUiState } from './index.svelte';
  import PortalForm from './PortalForm.svelte';
  import { EmptyState, ListItem, ListItemActions } from '../../components';
  import { feedbackService } from '../../services/feedback/feedbackService.svelte';

  let { extensionManager = undefined } = $props();

  let editingId = $state<string | null>(null);
  let showNewForm = $state(false);
  let listContainer: HTMLDivElement | undefined = $state();

  // Bug 3 fix: react to portalsUiState store (works on mount AND while view is already open)
  $effect(() => {
    if (portalsUiState.openMode === 'new') {
      showNewForm = true;
      editingId = null;
      portalsUiState.openMode = 'list';
      tick().then(() => {
        const input = document.querySelector<HTMLInputElement>('#portal-name');
        input?.focus();
      });
    }
  });

  // Bug 2 fix: scroll selected row into view when selectedIndex changes
  $effect(() => {
    if (portalsUiState.selectedIndex >= 0 && listContainer) {
      tick().then(() => {
        const el = listContainer?.querySelector<HTMLElement>(`[data-index="${portalsUiState.selectedIndex}"]`);
        if (el) el.scrollIntoView({ block: 'nearest', behavior: 'auto' });
      });
    }
  });

  async function handleSave(portal: Portal) {
    if (editingId) {
      portalStore.update(editingId, portal);
      await removePortalFromIndex(editingId);
      await syncPortalToIndex({ ...portal, id: editingId });
    } else {
      portalStore.add(portal);
      await syncPortalToIndex(portal);
    }
    editingId = null;
    showNewForm = false;
  }

  async function handleDelete(portal: Portal) {
    const confirmed = await feedbackService.confirmAlert({
      title: 'Delete portal',
      message: `Delete "${portal.name}"? This cannot be undone.`,
      confirmText: 'Delete',
      variant: 'danger',
    });
    if (!confirmed) return;
    portalStore.remove(portal.id);
    await removePortalFromIndex(portal.id);
  }

  function handleEdit(portal: Portal) {
    editingId = portal.id;
    showNewForm = false;
  }

  function handleCancel() {
    editingId = null;
    showNewForm = false;
  }
</script>

<div class="view-container">

  {#if showNewForm}
    <div class="form-container">
      <PortalForm onsave={handleSave} oncancel={handleCancel} />
    </div>
  {/if}

  <div class="list custom-scrollbar" bind:this={listContainer}>
    {#if portalStore.portals.length === 0 && !showNewForm}
      <EmptyState 
        message="No portals yet." 
        description="Press + New to add your first URL shortcut."
      />
    {/if}

    {#each portalStore.portals as portal, i (portal.id)}
      {#if editingId === portal.id}
        <div class="form-container">
          <PortalForm portal={portal} isEditing={true} onsave={handleSave} oncancel={handleCancel} />
        </div>
      {:else}
        <ListItem
          data-index={i}
          title={portal.name}
          subtitle={portal.url}
          selected={portalsUiState.selectedIndex === i}
          onclick={() => portalsUiState.selectedIndex = i}
        >
          {#snippet leading()}
            <div class="w-8 h-8 rounded-lg bg-[var(--bg-tertiary)] flex items-center justify-center text-lg">{portal.icon}</div>
          {/snippet}
          {#snippet trailing()}
            <ListItemActions>
              <button class="btn-secondary h-7 w-7 flex items-center justify-center p-0" onclick={(e) => { e.stopPropagation(); handleEdit(portal); }} title="Edit">✏️</button>
              <button class="btn-danger h-7 w-7 flex items-center justify-center p-0" onclick={(e) => { e.stopPropagation(); handleDelete(portal); }} title="Delete">✕</button>
            </ListItemActions>
          {/snippet}
        </ListItem>
      {/if}
    {/each}
  </div>
</div>

<style>
  .form-container { padding: 12px 16px; border-bottom: 1px solid var(--separator); }
  .list { flex: 1; overflow-y: auto; min-height: 0; }
</style>

