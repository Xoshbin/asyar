<script lang="ts">
  import {
    SettingsForm,
    SettingsFormRow,
    Toggle,
    SegmentedControl,
  } from '../../../components';
  import type { SettingsHandler } from '../settingsHandlers.svelte';
  import { settingsService } from '../../../services/settings/settingsService.svelte';
  import ScheduledTasksSection from '../../../components/settings/ScheduledTasksSection.svelte';
  import { snippetService, enabledPersistence } from '../../../built-in-features/snippets/snippetService';

  let {
    handler,
  }: {
    handler: SettingsHandler;
  } = $props();

  let snippetsEnabled = $state(enabledPersistence.loadSync(true));
  let snippetsToggleError = $state<string | null>(null);

  async function toggleSnippets() {
    const desiredState = !snippetsEnabled;
    const result = await snippetService.setEnabled(desiredState);
    if (result.ok) {
      snippetsEnabled = desiredState;
      enabledPersistence.save(snippetsEnabled);
      snippetsToggleError = null;
    } else {
      snippetsToggleError = result.error || 'Failed to change expansion setting';
    }
  }

  let autoUpdate = $derived(
    settingsService.currentSettings.extensions?.autoUpdate !== false,
  );

  async function toggleAutoUpdate() {
    const newValue = !autoUpdate;
    await settingsService.updateSettings('extensions', {
      ...settingsService.currentSettings.extensions,
      autoUpdate: newValue,
    });
  }

  type EscapeBehavior = 'go-back' | 'close-window' | 'hide-and-reset';
  let escapeValue = $state<EscapeBehavior>('go-back');
  $effect(() => {
    escapeValue = (handler.settings.general.escapeInViewBehavior ?? 'go-back') as EscapeBehavior;
  });
  $effect(() => {
    const current = handler.settings.general.escapeInViewBehavior ?? 'go-back';
    if (escapeValue !== current) {
      handler.updateEscapeBehavior(escapeValue);
    }
  });
</script>

<SettingsForm>
  <SettingsFormRow
    label="Extension Search"
    description="Allow extensions to contribute results in the search bar"
  >
    <Toggle
      checked={handler.settings.search.enableExtensionSearch}
      onchange={() => handler.handleExtensionSearchToggle()}
    />
  </SettingsFormRow>

  <SettingsFormRow
    label="Extension Actions"
    separator
    description="Allow extensions to contribute actions to the main launcher's action panel (⌘K). When off, only Asyar's built-in actions appear."
  >
    <Toggle
      checked={handler.settings.search.allowExtensionActions}
      onchange={() => handler.handleExtensionActionsToggle()}
    />
  </SettingsFormRow>

  <SettingsFormRow
    label="Escape Key"
    separator
  >
    <SegmentedControl
      options={[
        { value: 'hide-and-reset', label: 'Reset Launcher' },
        { value: 'go-back', label: 'Step Backwards' },
        { value: 'close-window', label: 'Hide Window' },
      ]}
      bind:value={escapeValue}
    />
  </SettingsFormRow>

  <SettingsFormRow
    label="Auto Updates"
    separator
    description="Extensions update silently in the background"
  >
    <Toggle checked={autoUpdate} onchange={toggleAutoUpdate} />
  </SettingsFormRow>

  <SettingsFormRow
    label="Text Expansion"
    separator
    description="Automatically expand text snippets as you type. Requires Accessibility permission on macOS."
  >
    <Toggle checked={snippetsEnabled} onchange={toggleSnippets} />
  </SettingsFormRow>

  <SettingsFormRow
    label="Developer Mode"
    separator
    description="Enables developer tools like the extension inspector, verbose logging, and sideloading. Intended for extension developers."
  >
    <Toggle
      checked={handler.settings.developer?.enabled ?? false}
      onchange={() => handler.handleDeveloperModeToggle()}
    />
  </SettingsFormRow>
</SettingsForm>

{#if snippetsToggleError}
  <div class="error-message">{snippetsToggleError}</div>
{/if}

<ScheduledTasksSection />

{#if handler.saveError && handler.saveMessage}
  <div class="error-message">{handler.saveMessage}</div>
{/if}

<style>
  .error-message {
    padding: var(--space-3) var(--space-6);
    font-size: var(--font-size-sm);
    font-weight: 500;
    color: var(--accent-danger);
  }
</style>
