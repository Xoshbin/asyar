<script lang="ts">
  import { tick } from 'svelte';
  import { portalStore, type Portal } from './portalStore.svelte';
  import { syncPortalToIndex, removePortalFromIndex, portalsUiState } from './index.svelte';
  import PortalForm from './PortalForm.svelte';

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
    if (!confirm('Are you sure you want to delete this portal?')) return;
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
  <div class="view-header">
    <div class="flex items-center gap-2"><span>🌐</span> Portals</div>
    <button class="btn-secondary portals-add-btn" onclick={() => { showNewForm = true; editingId = null; }}>+ New</button>
  </div>

  {#if showNewForm}
    <div class="form-container">
      <PortalForm onsave={handleSave} oncancel={handleCancel} />
    </div>
  {/if}

  <div class="list" bind:this={listContainer}>
    {#if portalStore.portals.length === 0 && !showNewForm}
      <div class="empty-state">
        <p class="text-body font-medium">No portals yet.</p>
        <p class="text-caption">Press <kbd>+ New</kbd> to add your first URL shortcut.</p>
      </div>
    {/if}

    {#each portalStore.portals as portal, i (portal.id)}
      {#if editingId === portal.id}
        <div class="form-container">
          <PortalForm portal={portal} isEditing={true} onsave={handleSave} oncancel={handleCancel} />
        </div>
      {:else}
        <div class="list-row group" class:selected={portalsUiState.selectedIndex === i} data-index={i}>
          <div class="w-6 text-center text-lg">{portal.icon}</div>
          <div class="flex-1 min-w-0 flex flex-col gap-0.5">
            <span class="text-body font-medium">{portal.name}</span>
            <span class="text-caption truncate">{portal.url}</span>
          </div>
          <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button class="btn-secondary h-7 w-7 flex items-center justify-center p-0" onclick={() => handleEdit(portal)} title="Edit">✏️</button>
            <button class="btn-danger h-7 w-7 flex items-center justify-center p-0" onclick={() => handleDelete(portal)} title="Delete">🗑️</button>
          </div>
        </div>
      {/if}
    {/each}
  </div>
</div>

<style>
  .form-container { padding: 12px 16px; border-bottom: 1px solid var(--separator); }
  .list { flex: 1; overflow-y: auto; min-height: 0; }
  .portals-add-btn { padding: 4px 10px; font-size: 12px; }
</style>
