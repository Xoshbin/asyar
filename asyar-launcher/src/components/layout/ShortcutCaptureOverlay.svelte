<script lang="ts">
  import ShortcutCapture from '../../built-in-features/shortcuts/ShortcutCapture.svelte';
  import { shortcutService } from '../../built-in-features/shortcuts/shortcutService';
  import type { SearchResult } from '../../services/search/interfaces/SearchResult';

  let { target, oncapture, oncancel }: {
    target: SearchResult;
    oncapture?: () => void;
    oncancel?: () => void;
  } = $props();

  let captureError = $state<string | null>(null);

  async function handleCapture(shortcut: string) {
    const result = await shortcutService.register(
      target.objectId,
      target.name,
      (target.type === 'application' || target.type === 'command')
        ? target.type
        : 'command',
      shortcut,
      target.path ?? undefined
    );

    if (!result.ok) {
      const reason = result.conflict?.itemName ?? 'Unsupported key or OS error';
      captureError = `Could not assign shortcut: ${reason}`;
      setTimeout(() => { captureError = null; }, 4000);
      return; // Keep modal open — let user retry or cancel
    }

    oncapture?.();
  }

  function handleCancel() {
    oncancel?.();
  }
</script>

<ShortcutCapture events={{
  capture: handleCapture,
  cancel: handleCancel,
  excludeObjectId: target.objectId
}} />

{#if captureError}
  <div class="fixed top-4 left-1/2 -translate-x-1/2 z-[200] bg-red-600 text-white
              px-4 py-2 rounded-lg shadow-lg text-sm pointer-events-none">
    {captureError}
  </div>
{/if}
