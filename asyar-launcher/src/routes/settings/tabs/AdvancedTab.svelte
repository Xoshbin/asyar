<script lang="ts">
  import { SettingsCard, SettingsRow, Toggle } from '../../../components';
  import type { SettingsHandler } from '../settingsHandlers.svelte';
  import ScheduledTasksSection from '../../../components/settings/ScheduledTasksSection.svelte';
  import RuntimesSection from '../../../components/settings/RuntimesSection.svelte';
  import { t } from '../../../services/i18n';

  let {
    handler,
  }: {
    handler: SettingsHandler;
  } = $props();
</script>

<SettingsCard>
  <div id="advanced-developer">
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
