<script lang="ts">
  import RequiredPreferencesDialog from './RequiredPreferencesDialog.svelte';
  import { preferencesPromptStore } from '../../services/extension/preferencesPromptStore.svelte';
  import { extensionPreferencesService } from '../../services/extension/extensionPreferencesService.svelte';
  import { commandService } from '../../services/extension/commandService.svelte';
  import { logService } from '../../services/log/logService';

  async function handleSave(values: Record<string, unknown>) {
    const active = preferencesPromptStore.active;
    if (!active) return;

    const { extensionId, commandId, commandObjectId, missing } = active;

    // Persist each value. Each missing pref was pulled from the manifest
    // by `getMissingRequired`, so we can reuse the same declarations to
    // decide whether a value is extension-level (commandId null) or
    // command-level (commandId === the triggering command).
    for (const [key, value] of Object.entries(values)) {
      const decl = missing.find((p) => p.name === key);
      if (!decl) continue;

      // Determine scope: check the extension-level declarations first.
      // extensionPreferencesService.set() validates by name against the
      // right scope, so we pass `null` when the pref lives at the
      // extension level and `commandId` otherwise.
      const decls = extensionPreferencesService.getDeclarations(extensionId);
      const isExtensionLevel = decls?.extension.some((p) => p.name === key) ?? false;
      const scope: string | null = isExtensionLevel ? null : commandId;

      try {
        await extensionPreferencesService.set(extensionId, scope, key, value);
      } catch (err) {
        logService.error(
          `PreferencesPromptHost: failed to save '${key}' for ${extensionId}: ${err}`
        );
        return;
      }
    }

    preferencesPromptStore.close();

    // Resume the command that was blocked. Any preference changes just
    // fired `asyar:preferences-changed`, which extensionManager has already
    // delivered to the extension. Re-invoking executeCommand now sees an
    // empty required-missing set and dispatches to the handler.
    try {
      await commandService.executeCommand(commandObjectId);
    } catch (err) {
      logService.error(
        `PreferencesPromptHost: command re-invocation failed for ${commandObjectId}: ${err}`
      );
    }
  }

  function handleCancel() {
    preferencesPromptStore.close();
  }
</script>

{#if preferencesPromptStore.active}
  <RequiredPreferencesDialog
    extensionId={preferencesPromptStore.active.extensionId}
    commandId={preferencesPromptStore.active.commandId}
    missing={preferencesPromptStore.active.missing}
    onSave={handleSave}
    onCancel={handleCancel}
  />
{/if}
