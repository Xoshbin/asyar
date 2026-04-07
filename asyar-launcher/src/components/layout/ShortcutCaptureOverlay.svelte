<script lang="ts">
  import ShortcutCapture from '../../built-in-features/shortcuts/ShortcutCapture.svelte';
  import { shortcutService } from '../../built-in-features/shortcuts/shortcutService';
  import type { SearchResult } from '../../services/search/interfaces/SearchResult';
  import { fadeIn } from '$lib/transitions';

  let { target, oncapture, oncancel }: {
    target: SearchResult;
    oncapture?: () => void;
    oncancel?: () => void;
  } = $props();

  async function handleSave(detail: { modifier: string; key: string }): Promise<string | true> {
    const shortcut = `${detail.modifier}+${detail.key}`;
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
      return `Could not assign: ${reason}`;
    }

    return true;
  }

  function handleCancel() {
    oncancel?.();
  }
</script>

<div transition:fadeIn>
  <ShortcutCapture
    onsave={handleSave}
    oncancel={handleCancel}
    ondone={() => oncapture?.()}
    excludeObjectId={target.objectId}
  />
</div>
