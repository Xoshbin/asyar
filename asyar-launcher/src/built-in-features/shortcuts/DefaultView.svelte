<script lang="ts">
  import { shortcutStore, type ItemShortcut } from './shortcutStore.svelte';
  import { shortcutViewState } from './shortcutViewState.svelte';
  import { shortcutService } from './shortcutService';
  import { toDisplayKeys, normalizeShortcut } from './shortcutFormatter';
  import { extensionIframeManager } from '../../services/extension/extensionIframeManager.svelte';
  import {
    SplitListDetail,
    LauncherListRow,
    KeyboardHint,
    ShortcutRecorder,
    Badge,
    MetadataList,
    EmptyState,
  } from '../../components';
  import { feedbackService } from '../../services/feedback/feedbackService.svelte';
  import { actionService } from '../../services/action/actionService.svelte';
  import { searchStores } from '../../services/search/stores/search.svelte';
  import { ActionContext } from 'asyar-sdk/contracts';
  import { t } from '../../services/i18n';
  import extensionManager from '../../services/extension/extensionManager.svelte';
  import { toResolvedIcon } from '../../lib/icon';

  let mode = $state<'view' | 'edit'>('view');
  let captureModifier = $state('');
  let captureKey = $state('');

  const grouped = $derived(shortcutViewState.groups);
  const orderedItems = $derived(shortcutViewState.orderedItems);
  const selectedIndex = $derived(shortcutViewState.selectedIndex);
  const selectedShortcut = $derived(shortcutViewState.selectedShortcut);

  $effect(() => {
    const s = selectedShortcut;
    if (!s) {
      actionService.unregisterAction('shortcuts:remove');
      actionService.unregisterAction('shortcuts:change');
      return;
    }
    actionService.registerAction({
      id: 'shortcuts:change',
      title: t('features.shortcuts.action_change'),
      icon: 'icon:pencil',
      extensionId: 'shortcuts',
      category: t('categories.shortcuts'),
      context: ActionContext.EXTENSION_VIEW,
      execute: async () => {
        startEdit();
      },
    });
    actionService.registerAction({
      id: 'shortcuts:remove',
      title: t('features.shortcuts.action_remove'),
      icon: 'icon:trash',
      extensionId: 'shortcuts',
      category: t('categories.shortcuts'),
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

  // Keystroke-gate lifecycle while the capture surface is mounted. Mirrors
  // the old ShortcutCapture.svelte exactly — the launcher's keystroke
  // routing depends on these flags being set during capture.
  $effect(() => {
    if (mode !== 'edit') return;
    shortcutStore.isCapturing = true;
    extensionIframeManager.hasInputFocus = true;
    (document.activeElement as HTMLElement)?.blur();
    return () => {
      shortcutStore.isCapturing = false;
      extensionIframeManager.hasInputFocus = false;
    };
  });

  function startEdit() {
    captureModifier = '';
    captureKey = '';
    mode = 'edit';
  }

  function cancelEdit() {
    mode = 'view';
  }

  async function conflictChecker(shortcut: string): Promise<{ name: string } | null> {
    const conflict = await shortcutService.isConflict(
      normalizeShortcut(shortcut),
      selectedShortcut?.objectId,
    );
    if (conflict) return { name: conflict.itemName };
    return null;
  }

  async function handleSave(detail: { modifier: string; key: string }): Promise<string | true> {
    if (!selectedShortcut) return 'No item selected';
    const shortcut = `${detail.modifier}+${detail.key}`;
    const result = await shortcutService.register(
      selectedShortcut.objectId,
      selectedShortcut.itemName,
      selectedShortcut.itemType,
      shortcut,
      selectedShortcut.itemPath,
      selectedShortcut.itemIcon,
    );
    if (!result.ok) {
      const reason = result.conflict?.itemName ?? 'Unsupported key or OS error';
      return `Could not assign: ${reason}`;
    }
    return true;
  }

  async function handleRemove(id: string, name: string) {
    const confirmed = await feedbackService.confirmAlert({
      title: t('features.shortcuts.remove_confirm_title'),
      message: t('features.shortcuts.ui.remove_confirm', { name }),
      confirmText: t('common.remove'),
      variant: 'danger',
    });
    if (!confirmed) return;
    await shortcutService.unregister(id);
  }

  function shouldShowSectionHeader(index: number): 'applications' | 'commands' | null {
    if (orderedItems.length === 0) return null;
    if (index === 0 && grouped.applications.length > 0) return 'applications';
    if (index === grouped.applications.length && grouped.commands.length > 0) return 'commands';
    return null;
  }

  // Stored icons are plain strings (synced across launcher versions); command
  // icons come from the manifest so bundled files resolve.
  const iconForRow = (s: ItemShortcut) =>
    toResolvedIcon(s.itemIcon) ??
    (s.itemType === 'application' ? '📱' : (extensionManager.getCommandIcon(s.objectId) ?? '⚡'));
</script>

<div class="view-container">
  <SplitListDetail
    items={orderedItems}
    {selectedIndex}
    leftWidth={260}
    minLeftWidth={200}
    maxLeftWidth={500}
    ariaLabel="Shortcuts"
    emptyMessage={t('features.shortcuts.no_shortcuts')}
  >
    {#snippet listItem(s, index)}
      {@const section = shouldShowSectionHeader(index)}
      {#if section === 'applications'}
        <div class="list-section">{t('features.shortcuts.ui.applications')}</div>
      {:else if section === 'commands'}
        <div class="list-section">{t('features.shortcuts.ui.commands')}</div>
      {/if}
      <LauncherListRow
        data-index={index}
        selected={selectedIndex === index}
        title={s.itemName}
        icon={iconForRow(s)}
        onclick={() => shortcutViewState.setIndex(index)}
        ondblclick={() => startEdit()}
      />
    {/snippet}

    {#snippet detail()}
      {#if mode === 'edit' && selectedShortcut}
        <div class="form-panel">
          <div class="form-header">
            <h2 class="form-title">{t('features.shortcuts.ui.assign')}</h2>
            <p class="form-subtitle">
              Press the combination you want to use for {selectedShortcut.itemName}.
            </p>
          </div>
          <div class="form-body custom-scrollbar">
            <ShortcutRecorder
              bind:modifier={captureModifier}
              bind:key={captureKey}
              autoRecord={true}
              onsave={handleSave}
              oncancel={cancelEdit}
              ondone={cancelEdit}
              {conflictChecker}
            />
          </div>
        </div>
      {:else if selectedShortcut}
        <div class="shortcut-detail-content custom-scrollbar">
          <div class="detail-header">
            <h2 class="shortcut-name">{selectedShortcut.itemName}</h2>
          </div>

          <div class="hero-block">
            <KeyboardHint keys={toDisplayKeys(selectedShortcut.shortcut)} />
          </div>
        </div>

        <MetadataList
          title={t('common.information')}
          items={[
            {
              label: t('features.shortcuts.ui.name'),
              value: selectedShortcut.itemName,
            },
            {
              label: t('features.shortcuts.ui.type'),
              value: selectedShortcut.itemType,
            },
            {
              label: t('features.shortcuts.ui.path'),
              value: selectedShortcut.itemPath,
              mono: true,
            },
          ]}
        />
      {:else if shortcutStore.shortcuts.length === 0}
        <EmptyState
          message={t('features.shortcuts.no_shortcuts')}
          description={t('features.shortcuts.no_shortcuts_description')}
        >
          {#snippet icon()}
            <span class="text-4xl opacity-50">⌨️</span>
          {/snippet}
        </EmptyState>
      {:else}
        <EmptyState message={t('features.shortcuts.no_matching_shortcuts')}>
          {#snippet icon()}
            <span class="text-4xl opacity-50">🔍</span>
          {/snippet}
        </EmptyState>
      {/if}
    {/snippet}
  </SplitListDetail>
</div>

<style>
  .shortcut-detail-content {
    flex: 1;
    overflow-y: auto;
    padding: var(--space-6);
    display: flex;
    flex-direction: column;
    gap: var(--space-7);
  }
  .detail-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-5);
  }
  .shortcut-name {
    font-size: var(--font-size-lg);
    font-weight: 600;
    color: var(--text-primary);
    margin: 0;
  }

  .hero-block {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-7) var(--space-5);
    background: var(--bg-secondary);
    border-radius: var(--radius-md);
  }

  .form-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
  }
  .form-header {
    padding: var(--space-7) var(--space-8) 0;
    flex-shrink: 0;
  }
  .form-title {
    font-size: var(--font-size-lg);
    font-weight: 600;
    color: var(--text-primary);
    margin: 0;
  }
  .form-subtitle {
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
    margin: var(--space-2) 0 var(--space-6);
  }
  .form-body {
    flex: 1;
    overflow-y: auto;
    padding: 0 var(--space-8) var(--space-6);
  }
</style>
