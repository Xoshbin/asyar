<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import { ListItem, EmptyState, ActionFooter, Input } from '../../components';
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

  let selectedId = $state<string | null>(null);
  let editingId = $state<string | null>(null);
  let editingName = $state('');
  let editInputEl = $state<HTMLInputElement | null>(null);

  let layouts = $derived(windowManagementState.customLayouts);

  // Auto-select first item if current selection is invalid
  $effect(() => {
    if (layouts.length > 0 && (!selectedId || !layouts.some((l) => l.id === selectedId))) {
      selectedId = layouts[0].id;
    } else if (layouts.length === 0) {
      selectedId = null;
    }
  });

  async function handleApply(id: string) {
    const layout = layouts.find((l) => l.id === id);
    if (!layout) return;
    await applyCustomLayout(layout, store);
  }

  async function handleSaveCurrent() {
    if (!store) return;
    try {
      const bounds = await windowManagementService.getWindowBounds();
      const name = `${Math.round(bounds.width)}x${Math.round(bounds.height)}`;
      await windowManagementState.addCustomLayout(name, bounds, store);
      const created =
        windowManagementState.customLayouts.find(
          (l) => l.name === name && l.bounds.x === bounds.x && l.bounds.y === bounds.y,
        ) ?? windowManagementState.customLayouts[windowManagementState.customLayouts.length - 1];
      if (created) {
        await syncLayoutToIndex(created, store);
        selectedId = created.id;
      }
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
    void tick().then(() => {
      if (editInputEl) {
        editInputEl.focus();
        editInputEl.select();
      }
    });
  }

  async function commitRename() {
    if (!editingId || !store) {
      editingId = null;
      return;
    }
    const id = editingId;
    const newName = editingName.trim();
    editingId = null;
    if (newName) {
      await renameLayout(id, newName, store);
      await feedbackService.showHUD(`Renamed to "${newName}"`);
    }
  }

  function cancelRename() {
    editingId = null;
    editingName = '';
  }

  async function handleDelete(id: string) {
    if (!store) return;
    const layout = layouts.find((l) => l.id === id);
    if (!layout) return;
    const name = layout.name;
    await deleteLayout(id, store);
    await feedbackService.showHUD(`Deleted "${name}"`);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (editingId) {
      if (e.key === 'Enter') {
        e.preventDefault();
        void commitRename();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancelRename();
      }
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!selectedId && layouts.length > 0) {
        selectedId = layouts[0].id;
        return;
      }
      const idx = layouts.findIndex((l) => l.id === selectedId);
      if (idx < layouts.length - 1) {
        selectedId = layouts[idx + 1].id;
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!selectedId && layouts.length > 0) {
        selectedId = layouts[0].id;
        return;
      }
      const idx = layouts.findIndex((l) => l.id === selectedId);
      if (idx > 0) {
        selectedId = layouts[idx - 1].id;
      }
    } else if (e.key === 'Enter' && selectedId) {
      e.preventDefault();
      void handleApply(selectedId);
    } else if ((e.metaKey || e.ctrlKey) && e.key === 'r' && selectedId) {
      e.preventDefault();
      startRename(selectedId);
    } else if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
      e.preventDefault();
      void handleSaveCurrent();
    }
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

    if (!selectedId) {
      actionService.unregisterAction('window-management:apply-layout');
      actionService.unregisterAction('window-management:rename-layout');
      actionService.unregisterAction('window-management:delete-layout');
      return;
    }

    const id = selectedId;
    const layout = layouts.find((l) => l.id === id);
    if (!layout) return;

    actionService.registerAction({
      id: 'window-management:apply-layout',
      title: `Apply "${layout.name}"`,
      icon: 'icon:play',
      shortcut: '↵',
      extensionId: 'window-management',
      category: 'window-management',
      context: ActionContext.EXTENSION_VIEW,
      execute: () => handleApply(id),
    });

    actionService.registerAction({
      id: 'window-management:rename-layout',
      title: `Rename "${layout.name}"`,
      icon: 'icon:edit',
      shortcut: '⌘R',
      extensionId: 'window-management',
      category: 'window-management',
      context: ActionContext.EXTENSION_VIEW,
      execute: () => startRename(id),
    });

    actionService.registerAction({
      id: 'window-management:delete-layout',
      title: `Delete "${layout.name}"`,
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

  onMount(() => {
    window.addEventListener('keydown', handleKeydown);
    return () => {
      window.removeEventListener('keydown', handleKeydown);
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
      {#each layouts as layout (layout.id)}
        <ListItem
          title={layout.name}
          subtitle={`${Math.round(layout.bounds.width)}×${Math.round(layout.bounds.height)} at (${Math.round(layout.bounds.x)}, ${Math.round(layout.bounds.y)})`}
          selected={selectedId === layout.id}
          onclick={() => {
            selectedId = layout.id;
          }}
          ondblclick={() => {
            startRename(layout.id);
          }}
        >
          {#snippet leading()}
            <div class="layout-icon">⊞</div>
          {/snippet}
          {#snippet content()}
            {#if editingId === layout.id}
              <div class="inline-rename-wrapper" onclick={(e) => e.stopPropagation()}>
                <input
                  bind:this={editInputEl}
                  type="text"
                  class="rename-input"
                  bind:value={editingName}
                  onblur={() => void commitRename()}
                  onkeydown={handleKeydown}
                />
              </div>
            {/if}
          {/snippet}
        </ListItem>
      {/each}
    {/if}
  </div>

  <ActionFooter>
    {#snippet right()}
      <span class="count-label">
        {layouts.length} custom {layouts.length === 1 ? 'layout' : 'layouts'}
      </span>
    {/snippet}
  </ActionFooter>
</div>

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

  .inline-rename-wrapper {
    margin-top: var(--space-1);
  }

  .rename-input {
    width: 100%;
    max-width: 280px;
    padding: var(--space-1) var(--space-2);
    font-family: var(--font-ui);
    font-size: var(--font-size-sm);
    color: var(--text-primary);
    background: var(--bg-secondary);
    border: 1px solid var(--accent-primary);
    border-radius: var(--radius-sm);
    outline: none;
  }

  .count-label {
    font-size: var(--font-size-xs);
    color: var(--text-tertiary);
  }
</style>
