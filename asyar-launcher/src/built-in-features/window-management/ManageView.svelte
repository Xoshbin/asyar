<script lang="ts">
  import { onDestroy } from 'svelte';
  import { ListItem, EmptyState } from '../../components';
  import { windowManagementState } from './state.svelte';
  import { windowManagementService } from '../../services/windowManagement/windowManagementService';
  import { feedbackService } from '../../services/feedback/feedbackService.svelte';
  import { actionService } from '../../services/action/actionService.svelte';
  import { viewManager } from '../../services/extension/viewManager.svelte';
  import { applyCustomLayout, deleteLayout, syncLayoutToIndex } from './layoutLifecycle';
  import type { IStorageService } from 'asyar-sdk/contracts';
  import { ActionContext } from 'asyar-sdk/contracts';
  import { t } from '../../services/i18n';

  interface Props {
    store?: IStorageService;
  }
  let { store }: Props = $props();

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
        context: {
          message: err.message
            ? t('features.window_management.err_save_detail', { detail: err.message })
            : t('features.window_management.err_save'),
        },
      });
    }
  }

  function startRename(id: string) {
    const layout = layouts.find((l) => l.id === id);
    if (!layout) return;
    windowManagementState.startRename(id);
    viewManager.navigateToView('window-management/RenameLayoutView', { searchable: false });
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
      title: t('features.window_management.save_current_layout_title'),
      description: t('features.window_management.save_current_layout_desc'),
      icon: 'icon:plus',
      shortcut: 'Mod+N',
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
      title: t('features.window_management.ui.apply_title', { name }),
      icon: 'icon:play',
      shortcut: 'Enter',
      primary: true,
      extensionId: 'window-management',
      category: 'window-management',
      context: ActionContext.EXTENSION_VIEW,
      execute: () => handleApply(id),
    });

    actionService.registerAction({
      id: 'window-management:rename-layout',
      title: t('features.window_management.ui.rename_title', { name }),
      icon: 'icon:edit',
      shortcut: 'Mod+R',
      extensionId: 'window-management',
      category: 'window-management',
      context: ActionContext.EXTENSION_VIEW,
      execute: () => startRename(id),
    });

    actionService.registerAction({
      id: 'window-management:delete-layout',
      label: t('features.window_management.ui.delete_title', { name }),
      icon: 'icon:trash',
      shortcut: 'Control+X',
      confirm: true,
      destructive: true,
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
        message={t('features.window_management.no_layouts')}
        description={t('features.window_management.no_layouts_description')}
      />
    {:else}
      <div class="section-header">{t('features.window_management.custom_layouts_header')}</div>
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
</style>
