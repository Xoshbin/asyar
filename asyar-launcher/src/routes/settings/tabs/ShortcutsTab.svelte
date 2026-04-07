<script lang="ts">
  import { SettingsSection, ShortcutRecorder } from '../../../components';
  import { shortcutService } from '../../../built-in-features/shortcuts/shortcutService';
  import { normalizeShortcut } from '../../../built-in-features/shortcuts/shortcutFormatter';
  import type { SettingsHandler } from '../settingsHandlers.svelte';

  let {
    handler,
  }: {
    handler: SettingsHandler;
  } = $props();

  async function conflictChecker(shortcut: string): Promise<{ name: string } | null> {
    // Exclude the launcher itself from conflict checks (it's being reassigned)
    const conflict = await shortcutService.isConflict(normalizeShortcut(shortcut), 'launcher');
    if (conflict) return { name: conflict.itemName };
    return null;
  }

  async function handleSave(detail: { modifier: string; key: string }): Promise<string | true> {
    handler.selectedModifier = detail.modifier;
    handler.selectedKey = detail.key;
    handler.isSaving = true;
    handler.saveMessage = '';
    handler.saveError = false;

    try {
      const { updateShortcut } = await import('../../../utils/shortcutManager');
      const success = await updateShortcut(detail.modifier, detail.key);
      handler.isSaving = false;
      if (success) return true;
      return 'Cannot save, shortcut may be reserved by the OS or another app';
    } catch (e) {
      handler.isSaving = false;
      return 'Cannot save, shortcut may be reserved by the OS or another app';
    }
  }
</script>

<SettingsSection title="Global Shortcuts">
  <div class="mb-8 p-6 pt-2">
    <div class="mb-2 font-medium text-[var(--text-primary)]">Asyar activation shortcut</div>
    <div class="text-sm mb-6 text-[var(--text-secondary)]">
      This shortcut will show or hide Asyar from anywhere on your system
    </div>

    <div class="mb-6">
      <ShortcutRecorder
        bind:modifier={handler.selectedModifier}
        bind:key={handler.selectedKey}
        placeholder="Click to set shortcut"
        disabled={handler.isSaving}
        onsave={handleSave}
        {conflictChecker}
      />
    </div>
  </div>
</SettingsSection>
