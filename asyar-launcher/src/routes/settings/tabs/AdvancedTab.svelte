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

  let escapeValue = $state<'close-window' | 'go-back'>('close-window');
  $effect(() => {
    escapeValue = (handler.settings.general.escapeInViewBehavior ?? 'close-window') as 'close-window' | 'go-back';
  });
  $effect(() => {
    const current = handler.settings.general.escapeInViewBehavior ?? 'close-window';
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
    label="Escape Key"
    separator
    description="What happens when you press Escape while a view is open"
  >
    <SegmentedControl
      options={[
        { value: 'close-window', label: 'Close launcher' },
        { value: 'go-back', label: 'Go back' },
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
