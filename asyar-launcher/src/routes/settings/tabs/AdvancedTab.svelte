<script lang="ts">
  import {
    SettingsCard,
    SettingsRow,
    SettingsPaneHeader,
    Toggle,
    SegmentedControl,
  } from '../../../components';
  import type { SettingsHandler } from '../settingsHandlers.svelte';
  import { settingsService } from '../../../services/settings/settingsService.svelte';
  import ScheduledTasksSection from '../../../components/settings/ScheduledTasksSection.svelte';
  import RuntimesSection from '../../../components/settings/RuntimesSection.svelte';
  import {
    snippetService,
    enabledPersistence,
  } from '../../../built-in-features/snippets/snippetService';

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

  let autoUpdate = $derived(settingsService.currentSettings.extensions?.autoUpdate !== false);

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

<SettingsPaneHeader title="Advanced" subtitle="Behaviour that most people never need to change." />

<div class="section-header">Extension surface</div>
<SettingsCard>
  <div id="advanced-extension-surface">
    <SettingsRow
      label="Extension results in search"
      description="Allow extensions to contribute results in the search bar."
    >
      <Toggle
        checked={handler.settings.search.enableExtensionSearch}
        onchange={() => handler.handleExtensionSearchToggle()}
      />
    </SettingsRow>
    <SettingsRow
      label="Extension actions in ⌘K"
      description="When off, only Asyar's built-in actions appear in the action panel."
    >
      <Toggle
        checked={handler.settings.search.allowExtensionActions}
        onchange={() => handler.handleExtensionActionsToggle()}
      />
    </SettingsRow>
    <SettingsRow
      label="Auto-update extensions"
      description="Updates install silently in the background."
    >
      <Toggle checked={autoUpdate} onchange={toggleAutoUpdate} />
    </SettingsRow>
  </div>
</SettingsCard>

<div class="section-header">Input</div>
<SettingsCard>
  <div id="advanced-input">
    <SettingsRow label="Escape key" description="What Escape does inside the launcher.">
      <SegmentedControl
        options={[
          { value: 'hide-and-reset', label: 'Reset Launcher' },
          { value: 'go-back', label: 'Step Backwards' },
          { value: 'close-window', label: 'Hide Window' },
        ]}
        bind:value={escapeValue}
      />
    </SettingsRow>
    <SettingsRow
      label="Text expansion"
      description="Expand snippets as you type. Requires Accessibility permission on macOS."
    >
      <Toggle checked={snippetsEnabled} onchange={toggleSnippets} />
    </SettingsRow>
    <SettingsRow
      label="Developer mode"
      description="Enables the extension inspector, verbose logging, and sideloading."
    >
      <Toggle
        checked={handler.settings.developer?.enabled ?? false}
        onchange={() => handler.handleDeveloperModeToggle()}
      />
    </SettingsRow>
  </div>
</SettingsCard>

{#if snippetsToggleError}
  <div class="error-message">{snippetsToggleError}</div>
{/if}

<ScheduledTasksSection />

<RuntimesSection />

{#if handler.saveError && handler.saveMessage}
  <div class="error-message">{handler.saveMessage}</div>
{/if}

<style>
  .error-message {
    font-size: var(--font-size-sm);
    font-weight: 500;
    color: var(--accent-danger);
  }
</style>
