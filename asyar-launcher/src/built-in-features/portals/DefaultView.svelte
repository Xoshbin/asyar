<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import { get } from 'svelte/store';
  import { portalStore, type Portal } from './portalStore';
  import { syncPortalToIndex, removePortalFromIndex, portalsOpenMode, portalsSelectedIndex } from './index';
  import PortalForm from './PortalForm.svelte';

  export let extensionManager: any = undefined;

  let portals: Portal[] = [];
  let editingId: string | null = null;
  let showNewForm = false;
  let listContainer: HTMLDivElement;

  const unsub = portalStore.subscribe(list => { portals = list; });
  onDestroy(() => unsub());

  // Bug 3 fix: react to portalsOpenMode store (works on mount AND while view is already open)
  $: if ($portalsOpenMode === 'new') {
    showNewForm = true;
    editingId = null;
    portalsOpenMode.set('list');
    tick().then(() => {
      const input = document.querySelector<HTMLInputElement>('#portal-name');
      input?.focus();
    });
  }

  // Bug 2 fix: scroll selected row into view when selectedIndex changes
  $: if ($portalsSelectedIndex >= 0 && listContainer) {
    tick().then(() => {
      const el = listContainer.querySelector<HTMLElement>(`[data-index="${$portalsSelectedIndex}"]`);
      if (el) el.scrollIntoView({ block: 'nearest', behavior: 'auto' });
    });
  }

  async function handleSave(e: CustomEvent<Portal>) {
    const portal = e.detail;
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

<div class="portals-view">
  <div class="header">
    <div class="title"><span>🌐</span> Portals</div>
    <button class="btn-new" on:click={() => { showNewForm = true; editingId = null; }}>+ New</button>
  </div>

  {#if showNewForm}
    <div class="form-container">
      <PortalForm on:save={handleSave} on:cancel={handleCancel} />
    </div>
  {/if}

  <div class="list" bind:this={listContainer}>
    {#if portals.length === 0 && !showNewForm}
      <div class="empty-state">
        <p>No portals yet.</p>
        <p class="hint">Press <kbd>+ New</kbd> to add your first URL shortcut.</p>
      </div>
    {/if}

    {#each portals as portal, i (portal.id)}
      {#if editingId === portal.id}
        <div class="form-container">
          <PortalForm portal={portal} isEditing={true} on:save={handleSave} on:cancel={handleCancel} />
        </div>
      {:else}
        <div class="portal-row" class:selected={$portalsSelectedIndex === i} data-index={i}>
          <span class="portal-icon">{portal.icon}</span>
          <div class="portal-info">
            <span class="portal-name">{portal.name}</span>
            <span class="portal-url">{portal.url}</span>
          </div>
          <div class="portal-actions">
            <button class="icon-btn" on:click={() => handleEdit(portal)} title="Edit">✏️</button>
            <button class="icon-btn danger" on:click={() => handleDelete(portal)} title="Delete">🗑️</button>
          </div>
        </div>
      {/if}
    {/each}
  </div>
</div>

<style>
  .portals-view {
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
  .btn-new {
    font-size: 12px;
    padding: 4px 10px;
    border-radius: 6px;
    border: 1px solid var(--border-color);
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.15s;
  }
  .btn-new:hover { background: var(--bg-hover); color: var(--text-primary); }
  .form-container { padding: 12px 16px; }
  .list { flex: 1; overflow-y: auto; padding: 8px 0; min-height: 0; }
  .portal-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 16px;
    border-bottom: 1px solid var(--border-color);
    transition: background 0.1s;
  }
  .portal-row:hover { background: var(--bg-hover); }
  .portal-row.selected { background: var(--bg-selected); }
  .portal-icon { font-size: 18px; flex-shrink: 0; width: 24px; text-align: center; }
  .portal-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .portal-name { font-size: 13px; font-weight: 500; }
  .portal-url { font-size: 11px; color: var(--text-tertiary); text-overflow: ellipsis; white-space: nowrap; overflow: hidden; }
  .portal-actions { display: flex; gap: 4px; opacity: 0; transition: opacity 0.15s; }
  .portal-row:hover .portal-actions { opacity: 1; }
  .icon-btn {
    background: none; border: none; cursor: pointer;
    font-size: 14px; padding: 4px; border-radius: 4px;
    transition: background 0.1s;
  }
  .icon-btn:hover { background: var(--bg-selected); }
  .empty-state {
    padding: 40px 16px;
    text-align: center;
    color: var(--text-secondary);
    font-size: 13px;
  }
  .empty-state .hint { font-size: 12px; color: var(--text-tertiary); margin-top: 4px; }
  kbd {
    font-size: 11px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: 3px;
    padding: 1px 5px;
  }
</style>
