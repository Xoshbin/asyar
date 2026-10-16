<script lang="ts">
  import { SettingsCard, SettingsRow, Toggle, Select } from '../../../components';
  import type { PopToRootDelay } from '../../../services/settings/types/AppSettingsType';
  import { resolveEscapeBehavior, type EscapeBehavior } from '../../../lib/keyboard/escapeBehavior';
  import type { SettingsHandler } from '../settingsHandlers.svelte';
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

  // Order matches Raycast: navigate-back first, pop-to-root second.
  const escapeOptions = $derived([
    { value: 'go-back', label: t('settings.advanced.escape_back') },
    { value: 'hide-and-reset', label: t('settings.advanced.escape_reset') },
  ]);

  const popToRootOptions = $derived([
    { value: 'immediately', label: t('settings.advanced.pop_to_root_immediately') },
    { value: '10s', label: t('settings.advanced.pop_to_root_10s') },
    { value: '1m', label: t('settings.advanced.pop_to_root_1min') },
    { value: '5m', label: t('settings.advanced.pop_to_root_5min') },
    { value: 'never', label: t('settings.advanced.pop_to_root_never') },
  ]);
</script>

<div class="section-header">{t('settings.advanced.section_extension_surface')}</div>
<SettingsCard>
  <div id="advanced-extension-surface">
    <SettingsRow
      label={t('settings.advanced.extension_search')}
      description={t('settings.advanced.extension_search_description')}
    >
      <Toggle
        checked={handler.settings.search?.enableExtensionSearch ?? false}
        onchange={() => handler.handleExtensionSearchToggle()}
      />
    </SettingsRow>
    <SettingsRow
      label={t('settings.advanced.auto_update_extensions')}
      description={t('settings.advanced.auto_update_extensions_description')}
    >
      <Toggle
        checked={handler.settings.extensions?.autoUpdate !== false}
        onchange={() => handler.handleExtensionAutoUpdateToggle()}
      />
    </SettingsRow>
  </div>
</SettingsCard>

<div class="section-header">{t('settings.advanced.section_input')}</div>
<SettingsCard>
  <div id="advanced-input">
    <SettingsRow
      label={t('settings.advanced.pop_to_root')}
      description={t('settings.advanced.pop_to_root_description')}
    >
      <Select
        value={handler.settings.general?.popToRootDelay ?? '1m'}
        options={popToRootOptions}
        onchange={(value) => handler.updatePopToRootDelay(value as PopToRootDelay)}
      />
    </SettingsRow>
    <SettingsRow
      label={t('settings.advanced.escape_key')}
      description={t('settings.advanced.escape_key_description')}
    >
      <Select
        value={resolveEscapeBehavior(handler.settings.general?.escapeInViewBehavior)}
        options={escapeOptions}
        onchange={(v) => handler.updateEscapeBehavior(v as EscapeBehavior)}
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
