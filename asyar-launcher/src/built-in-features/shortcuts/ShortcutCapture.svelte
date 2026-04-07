<script lang="ts">
  import { shortcutService } from './shortcutService';
  import { extensionIframeManager } from '../../services/extension/extensionIframeManager.svelte';
  import { shortcutStore } from './shortcutStore.svelte';
  import { ShortcutRecorder, ModalOverlay } from '../../components';
  import { normalizeShortcut } from './shortcutFormatter';

  let {
    onsave,
    oncancel,
    ondone,
    excludeObjectId = undefined,
  }: {
    onsave?: (detail: { modifier: string; key: string }) => Promise<string | true>;
    oncancel?: () => void;
    ondone?: () => void;
    excludeObjectId?: string;
  } = $props();

  let modifier = $state('');
  let key = $state('');

  async function conflictChecker(shortcut: string): Promise<{ name: string } | null> {
    const conflict = await shortcutService.isConflict(normalizeShortcut(shortcut), excludeObjectId);
    if (conflict) return { name: conflict.itemName };
    return null;
  }

  function handleCancel() {
    oncancel?.();
  }

  // Prevent the launcher from stealing focus and consuming keystrokes
  $effect(() => {
    shortcutStore.isCapturing = true;
    extensionIframeManager.hasInputFocus = true;
    // Blur the search input so it doesn't consume keystrokes
    (document.activeElement as HTMLElement)?.blur();

    return () => {
      shortcutStore.isCapturing = false;
      extensionIframeManager.hasInputFocus = false;
    };
  });
</script>

<ModalOverlay title="Assign Shortcut" subtitle="Press the combination you want to use">
  <div class="capture-recorder">
    <ShortcutRecorder
      bind:modifier
      bind:key
      autoRecord={true}
      {onsave}
      oncancel={handleCancel}
      {ondone}
      {conflictChecker}
    />
  </div>

  <div class="hint">Press <span class="kbd">Esc</span> to cancel</div>
</ModalOverlay>

<style>
  .capture-recorder {
    margin-bottom: 12px;
  }

  .hint {
    color: var(--text-tertiary);
    font-size: var(--font-size-sm);
    margin-top: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
  }

  .kbd {
    padding: 1px 6px;
    background: var(--bg-hover);
    color: var(--text-secondary);
    font-size: var(--font-size-sm);
    font-weight: 600;
    border-radius: var(--radius-xs, 4px);
    border: 1px solid var(--border-color);
  }
</style>
