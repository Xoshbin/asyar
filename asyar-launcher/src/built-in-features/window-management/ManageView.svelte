<script lang="ts">
  import { onDestroy } from 'svelte';
  import { ListItem, EmptyState, Modal, Input, Button } from '../../components';
  import { windowManagementState } from './state.svelte';
  import { windowManagementService } from '../../services/windowManagement/windowManagementService';
  import { feedbackService } from '../../services/feedback/feedbackService.svelte';
  import { actionService } from '../../services/action/actionService.svelte';
  import {
    applyCustomLayout,
    deleteLayout,
    renameLayout,
    syncLayoutToIndex,
  } from './layoutLifecycle';
  import type { IStorageService } from 'asyar-sdk/contracts';
  import { ActionContext } from 'asyar-sdk/contracts';

  interface Props {
    store?: IStorageService;
  }
  let { store }: Props = $props();

  let isRenameModalOpen = $state(false);
  let editingId = $state<string | null>(null);
  let editingName = $state('');

  let layouts = $derived(windowManagementState.customLayouts);
  let selectedIndex = $derived(windowManagementState.selectedIndex);
  let selectedLayout = $derived(windowManagementState.selectedLayout);

  async function handleApply(id: string) {
    const layout = layouts.find((l) => l.id === id);
    if (!layout) return;
    await applyCustomLayout(layout, store);
  }

  async function handleSaveCurrent() {
    try {
      const bounds = await windowManagementService.getWindowBounds();
      const name = `${Math.round(bounds.width)}x${Math.round(bounds.height)}`;
      const created = await windowManagementState.addCustomLayout(name, bounds, store);
      await syncLayoutToIndex(created, store);
      await feedbackService.showHUD(`Saved "${name}"`);
    } catch (err: any) {
      await feedbackService.report({
        source: 'frontend',
        kind: 'manual',
        severity: 'error',
        retryable: false,
        context: { message: `Could not save layout${err.message ? ' — ' + err.message : ''}` },
      });
    }
  }

  function startRename(id: string) {
    const layout = layouts.find((l) => l.id === id);
    if (!layout) return;
    editingId = id;
    editingName = layout.name;
    isRenameModalOpen = true;
  }

  async function commitRename() {
    if (!editingId) {
      isRenameModalOpen = false;
      return;
    }
    const id = editingId;
    const newName = editingName.trim();
    isRenameModalOpen = false;
    editingId = null;
    if (newName) {
      await renameLayout(id, newName, store);
      await feedbackService.showHUD(`Renamed to "${newName}"`);
    }
  }

  function cancelRename() {
    isRenameModalOpen = false;
    editingId = null;
    editingName = '';
  }

  async function handleDelete(id: string) {
    const layout = layouts.find((l) => l.id === id);
    if (!layout) return;
    const name = layout.name;
    await deleteLayout(id, store);
    await feedbackService.showHUD(`Deleted "${name}"`);
  }

  $effect(() => {
    // Register base save action
    actionService.registerAction({
      id: 'window-management:save-current-window',
      title: 'Save Current Window as Layout',
      description: 'Capture the frontmost window position and size as a custom layout',
      icon: 'icon:plus',
      shortcut: '⌘N',
      extensionId: 'window-management',
      category: 'window-management',
      context: ActionContext.EXTENSION_VIEW,
      execute: () => handleSaveCurrent(),
    });

    const current = selectedLayout;
    if (!current) {
      actionService.unregisterAction('window-management:apply-layout');
      actionService.unregisterAction('window-management:rename-layout');
      actionService.unregisterAction('window-management:delete-layout');
      return;
    }

    const id = current.id;
    const name = current.name;

    actionService.registerAction({
      id: 'window-management:apply-layout',
      title: `Apply "${name}"`,
      icon: 'icon:play',
      shortcut: '↵',
      extensionId: 'window-management',
      category: 'window-management',
      context: ActionContext.EXTENSION_VIEW,
      execute: () => handleApply(id),
    });

    actionService.registerAction({
      id: 'window-management:rename-layout',
      title: `Rename "${name}"`,
      icon: 'icon:edit',
      shortcut: '⌘R',
      extensionId: 'window-management',
      category: 'window-management',
      context: ActionContext.EXTENSION_VIEW,
      execute: () => startRename(id),
    });

    actionService.registerAction({
      id: 'window-management:delete-layout',
      title: `Delete "${name}"`,
      icon: 'icon:trash',
      shortcut: '⌘⌫',
      extensionId: 'window-management',
      category: 'window-management',
      context: ActionContext.EXTENSION_VIEW,
      execute: () => handleDelete(id),
    });

    return () => {
      actionService.unregisterAction('window-management:apply-layout');
      actionService.unregisterAction('window-management:rename-layout');
      actionService.unregisterAction('window-management:delete-layout');
    };
  });

  onDestroy(() => {
    actionService.unregisterAction('window-management:save-current-window');
    actionService.unregisterAction('window-management:apply-layout');
    actionService.unregisterAction('window-management:rename-layout');
    actionService.unregisterAction('window-management:delete-layout');
  });
</script>

<div class="view-container">
  <div class="list custom-scrollbar">
    {#if layouts.length === 0}
      <EmptyState
        message="No custom layouts yet"
        description="Position any window on screen and press ⌘N (or ⌘K → Save Current Window as Layout) to capture it."
      />
    {:else}
      <div class="section-header">Custom Layouts</div>
      {#each layouts as layout, index (layout.id)}
        <ListItem
          title={layout.name}
          subtitle={`${Math.round(layout.bounds.width)}×${Math.round(layout.bounds.height)} at (${Math.round(layout.bounds.x)}, ${Math.round(layout.bounds.y)})`}
          selected={selectedIndex === index}
          onclick={() => {
            windowManagementState.setIndex(index);
          }}
          ondblclick={() => {
            startRename(layout.id);
          }}
        >
          {#snippet leading()}
            <div class="layout-icon">⊞</div>
          {/snippet}
        </ListItem>
      {/each}
    {/if}
  </div>
</div>

<Modal
  bind:isOpen={isRenameModalOpen}
  title="Rename Layout"
  subtitle="Give this window layout a recognizable name"
  onEnter={commitRename}
  onEscape={cancelRename}
>
  <div class="modal-body">
    <Input placeholder="e.g. Work Setup, Right Focus..." bind:value={editingName} />
  </div>
  {#snippet actions()}
    <div class="modal-actions">
      <Button onclick={cancelRename}>Cancel</Button>
      <Button variant="primary" onclick={commitRename} disabled={!editingName.trim()}>Save</Button>
    </div>
  {/snippet}
</Modal>

<style>
  .view-container {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .list {
    flex: 1;
    overflow-y: auto;
    min-height: 0;
  }

  .section-header {
    padding: var(--space-2) var(--space-5) var(--space-1);
    font-size: var(--font-size-xs);
    font-weight: 600;
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wide);
  }

  .layout-icon {
    width: var(--size-xl);
    height: var(--size-xl);
    border-radius: var(--radius-md);
    background: var(--bg-tertiary);
    color: var(--text-secondary);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: var(--font-size-lg);
  }

  .modal-body {
    padding: var(--space-4) 0;
  }

  .modal-actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-3);
  }
</style>
