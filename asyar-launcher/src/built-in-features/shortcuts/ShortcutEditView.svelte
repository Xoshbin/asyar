<script lang="ts">
  import { KeyboardHint, ShortcutRecorder } from '../../components';
  import { extensionIframeManager } from '../../services/extension/extensionIframeManager.svelte';
  import { viewManager } from '../../services/extension/viewManager.svelte';
  import { t } from '../../services/i18n';
  import { normalizeShortcut } from './shortcutFormatter';
  import { shortcutService } from './shortcutService';
  import { shortcutStore } from './shortcutStore.svelte';
  import { shortcutViewState } from './shortcutViewState.svelte';

  let captureModifier = $state('');
  let captureKey = $state('');

  const targetShortcut = $derived(
    shortcutViewState.editingShortcut ?? shortcutViewState.selectedShortcut,
  );

  // Prevent the launcher from stealing focus and consuming keystrokes while capturing.
  $effect(() => {
    shortcutStore.isCapturing = true;
    extensionIframeManager.hasInputFocus = true;
    (document.activeElement as HTMLElement)?.blur();

    return () => {
      shortcutStore.isCapturing = false;
      extensionIframeManager.hasInputFocus = false;
    };
  });

  async function conflictChecker(shortcut: string): Promise<{ name: string } | null> {
    const conflict = await shortcutService.isConflict(
      normalizeShortcut(shortcut),
      targetShortcut?.objectId,
    );
    if (conflict) return { name: conflict.itemName };
    return null;
  }

  async function handleSave(detail: { modifier: string; key: string }): Promise<string | true> {
    if (!targetShortcut) return 'No item selected';
    const shortcut = `${detail.modifier}+${detail.key}`;
    const result = await shortcutService.register(
      targetShortcut.objectId,
      targetShortcut.itemName,
      targetShortcut.itemType,
      shortcut,
      targetShortcut.itemPath,
      targetShortcut.itemIcon,
    );
    if (!result.ok) {
      const reason = result.conflict?.itemName ?? 'Unsupported key or OS error';
      return `Could not assign: ${reason}`;
    }
    return true;
  }

  let closing = false;

  function handleClose() {
    if (closing) return;
    closing = true;
    shortcutViewState.clearEdit();
    viewManager.goBack();
  }
</script>

<div class="edit-view custom-scrollbar">
  <div class="edit-card">
    <div class="edit-header">
      <h2 class="edit-title">{t('features.shortcuts.ui.assign')}</h2>
      {#if targetShortcut}
        <p class="edit-subtitle">
          Press the combination you want to use for {targetShortcut.itemName}.
        </p>
      {/if}
    </div>

    <div class="edit-recorder">
      <ShortcutRecorder
        bind:modifier={captureModifier}
        bind:key={captureKey}
        autoRecord={true}
        onsave={handleSave}
        oncancel={handleClose}
        ondone={handleClose}
        {conflictChecker}
      />
    </div>

    <div class="edit-hint">
      {t('features.shortcuts.ui.press_pre')}
      <KeyboardHint keys="Esc" />
      {t('features.shortcuts.ui.press_post')}
    </div>
  </div>
</div>

<style>
  .edit-view {
    display: flex;
    flex-direction: column;
    height: 100%;
    padding: var(--space-7) var(--space-8);
    overflow-y: auto;
  }
  .edit-card {
    max-width: 34rem;
    width: 100%;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
  }
  .edit-title {
    font-size: var(--font-size-lg);
    font-weight: 600;
    color: var(--text-primary);
    margin: 0;
  }
  .edit-subtitle {
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
    margin: var(--space-2) 0 0;
  }
  .edit-hint {
    color: var(--text-tertiary);
    font-size: var(--font-size-sm);
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }
</style>
