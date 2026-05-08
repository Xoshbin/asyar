<script lang="ts">
  import {
    shortcutStore,
    groupShortcutsBySection,
    type ItemShortcut,
  } from './shortcutStore.svelte';
  import { shortcutService } from './shortcutService';
  import { toDisplayKeys, normalizeShortcut } from './shortcutFormatter';
  import { extensionIframeManager } from '../../services/extension/extensionIframeManager.svelte';
  import {
    SplitListDetail, LauncherListRow, KeyboardHint, ShortcutRecorder,
    Badge, ActionFooter, EmptyState,
  } from '../../components';
  import { feedbackService } from '../../services/feedback/feedbackService.svelte';
  import { actionService } from '../../services/action/actionService.svelte';
  import { searchStores } from '../../services/search/stores/search.svelte';
  import { ActionContext } from 'asyar-sdk/contracts';

  let mode = $state<'view' | 'edit'>('view');
  let captureModifier = $state('');
  let captureKey = $state('');

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

  const grouped = $derived(groupShortcutsBySection(filteredShortcuts));
  const orderedItems = $derived([...grouped.applications, ...grouped.commands]);

  let selectedIndex = $state(0);
  let selectedShortcut = $derived(
    selectedIndex >= 0 && selectedIndex < orderedItems.length ? orderedItems[selectedIndex] : null
  );

  $effect(() => {
    if (orderedItems.length === 0) {
      selectedIndex = -1;
    } else if (selectedIndex < 0 || selectedIndex >= orderedItems.length) {
      selectedIndex = 0;
    }
  });

  $effect(() => {
    const s = selectedShortcut;
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
      execute: async () => { startEdit(); },
    });
    actionService.registerAction({
      id: 'shortcuts:remove',
      title: 'Remove',
      icon: 'icon:trash',
      extensionId: 'shortcuts',
      category: 'Shortcuts',
      destructive: true,
      context: ActionContext.EXTENSION_VIEW,
      execute: async () => { await handleRemove(s.objectId, s.itemName); },
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
      title: 'Remove shortcut',
      message: `Remove the shortcut for "${name}"?`,
      confirmText: 'Remove',
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

  const iconForRow = (s: ItemShortcut) =>
    s.itemIcon ?? (s.itemType === 'application' ? '📱' : '⚡');
</script>

<div class="view-container">
  <SplitListDetail
    items={orderedItems}
    {selectedIndex}
    leftWidth={260}
    minLeftWidth={200}
    maxLeftWidth={500}
    ariaLabel="Shortcuts"
    emptyMessage="No shortcuts found"
  >
    {#snippet listItem(s, index)}
      {@const section = shouldShowSectionHeader(index)}
      {#if section === 'applications'}
        <div class="list-section">Applications</div>
      {:else if section === 'commands'}
        <div class="list-section">Commands</div>
      {/if}
      <LauncherListRow
        data-index={index}
        selected={selectedIndex === index}
        title={s.itemName}
        icon={iconForRow(s)}
        onclick={() => (selectedIndex = index)}
        ondblclick={() => startEdit()}
      />
    {/snippet}

    {#snippet detail()}
      {#if mode === 'edit' && selectedShortcut}
        <div class="form-panel">
          <div class="form-header">
            <h2 class="form-title">Assign Shortcut</h2>
            <p class="form-subtitle">Press the combination you want to use for {selectedShortcut.itemName}.</p>
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

          <div class="meta-grid">
            <div class="meta-label">Type</div>
            <div class="meta-value">{selectedShortcut.itemType}</div>
            {#if selectedShortcut.itemPath}
              <div class="meta-label">Path</div>
              <div class="meta-value mono">{selectedShortcut.itemPath}</div>
            {/if}
          </div>
        </div>
        <ActionFooter>
          {#snippet left()}
            <div class="flex items-center gap-3">
              <Badge text="shortcut" variant="default" mono />
              <span class="text-caption">{selectedShortcut.itemType}</span>
              <span class="text-caption shortcut-meta-dim">
                {selectedShortcut.itemName}
              </span>
            </div>
          {/snippet}
        </ActionFooter>
      {:else if shortcutStore.shortcuts.length === 0}
        <EmptyState
          message="No shortcuts configured yet"
          description='Use ⌘K on any search result and choose "Assign Shortcut" to add one.'
        >
          {#snippet icon()}
            <span class="text-4xl opacity-50">⌨️</span>
          {/snippet}
        </EmptyState>
      {:else}
        <EmptyState
          message="No matching shortcuts"
          description={`Nothing matches "${searchStores.query}".`}
        >
          {#snippet icon()}
            <span class="text-4xl opacity-50">🔍</span>
          {/snippet}
        </EmptyState>
      {/if}
    {/snippet}
  </SplitListDetail>
</div>

<style>
  .shortcut-detail-content { flex: 1; overflow-y: auto; padding: var(--space-6); display: flex; flex-direction: column; gap: var(--space-7); }
  .detail-header { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-5); }
  .shortcut-name { font-size: var(--font-size-lg); font-weight: 600; color: var(--text-primary); margin: 0; }
  .shortcut-meta-dim { color: var(--text-tertiary); }

  .hero-block { display: flex; align-items: center; justify-content: center; padding: var(--space-7) var(--space-5); background: var(--bg-secondary); border-radius: var(--radius-md); }

  .meta-grid { display: grid; grid-template-columns: max-content 1fr; gap: var(--space-3) var(--space-6); align-items: baseline; }
  .meta-label { font-size: var(--font-size-xs); color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.05em; }
  .meta-value { font-size: var(--font-size-sm); color: var(--text-primary); word-break: break-all; }
  .meta-value.mono { font-family: var(--font-mono); }

  .form-panel { display: flex; flex-direction: column; height: 100%; }
  .form-header { padding: var(--space-7) var(--space-8) 0; flex-shrink: 0; }
  .form-title { font-size: var(--font-size-lg); font-weight: 600; color: var(--text-primary); margin: 0; }
  .form-subtitle { font-size: var(--font-size-sm); color: var(--text-secondary); margin: var(--space-2) 0 var(--space-6); }
  .form-body { flex: 1; overflow-y: auto; padding: 0 var(--space-8) var(--space-6); }
</style>
