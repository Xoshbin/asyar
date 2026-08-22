<script lang="ts">
  import { SettingsCard, SettingsRow, Toggle, SegmentedControl } from '../../../components';
  import type { SettingsHandler } from '../settingsHandlers.svelte';
  import { settingsService } from '../../../services/settings/settingsService.svelte';
  import ScheduledTasksSection from '../../../components/settings/ScheduledTasksSection.svelte';
  import RuntimesSection from '../../../components/settings/RuntimesSection.svelte';
  import {
    snippetService,
    enabledPersistence,
  } from '../../../built-in-features/snippets/snippetService';
  import { t } from '../../../services/i18n';

  let {
    handler,
  }: {
    handler: SettingsHandler;
  } = $props();

  let snippetsEnabled = $state(enabledPersistence.loadSync(true));
  let snippetsToggleError = $state<string | null>(null);

  async function toggleSnippets() {
    snippetsToggleError = null;
    const next = !snippetsEnabled;
    try {
      await snippetService.setEnabled(next);
      snippetsEnabled = next;
    } catch (e) {
      snippetsToggleError = (e as Error).message || 'Failed to update snippets state';
    }
  }

  let autoUpdate = $derived(
    (settingsService.settings.extensions as Record<string, unknown> | undefined)?.autoUpdate !==
      false,
  );

  async function toggleAutoUpdate() {
    await settingsService.set('extensions.autoUpdate', !autoUpdate);
  }

  type EscapeBehavior = 'hide-and-reset' | 'go-back' | 'close-window';

  let escapeValue = $state<EscapeBehavior>(
    handler.settings.general?.escapeBehavior ?? 'hide-and-reset',
  );

  $effect(() => {
    const current = handler.settings.general?.escapeBehavior ?? 'hide-and-reset';
    if (escapeValue !== current) {
      handler.updateEscapeBehavior(escapeValue);
    }
  });
</script>

<div class="section-header">{t('settings.advanced.section_extension_surface')}</div>
<SettingsCard>
  <div id="advanced-extension-surface">
    <SettingsRow
      label={t('settings.advanced.extension_search')}
      description={t('settings.advanced.extension_search_description')}
    >
      <Toggle
        checked={handler.settings.search.enableExtensionSearch}
        onchange={() => handler.handleExtensionSearchToggle()}
      />
    </SettingsRow>
    <SettingsRow
      label={t('settings.advanced.extension_actions')}
      description={t('settings.advanced.extension_actions_description')}
    >
      <Toggle
        checked={handler.settings.search.allowExtensionActions}
        onchange={() => handler.handleExtensionActionsToggle()}
      />
    </SettingsRow>
    <SettingsRow
      label={t('settings.advanced.auto_update_extensions')}
      description={t('settings.advanced.auto_update_extensions_description')}
    >
      <Toggle checked={autoUpdate} onchange={toggleAutoUpdate} />
    </SettingsRow>
  </div>
</SettingsCard>

<div class="section-header">{t('settings.advanced.section_input')}</div>
<SettingsCard>
  <div id="advanced-input">
    <SettingsRow
      label={t('settings.advanced.escape_key')}
      description={t('settings.advanced.escape_key_description')}
    >
      <SegmentedControl
        options={[
          { value: 'hide-and-reset', label: t('settings.advanced.escape_reset') },
          { value: 'go-back', label: t('settings.advanced.escape_back') },
          { value: 'close-window', label: t('settings.advanced.escape_hide') },
        ]}
        bind:value={escapeValue}
      />
    </SettingsRow>
    <SettingsRow
      label={t('settings.advanced.text_expansion')}
      description={t('settings.advanced.text_expansion_description')}
    >
      <Toggle checked={snippetsEnabled} onchange={toggleSnippets} />
    </SettingsRow>
    <SettingsRow
      label={t('settings.advanced.developer_mode')}
      description={t('settings.advanced.developer_mode_description')}
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
