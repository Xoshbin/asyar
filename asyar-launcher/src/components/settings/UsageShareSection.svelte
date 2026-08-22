<script lang="ts">
  import { SettingsCard, SettingsRow, SettingsRadioGroup, Button } from '../index';
  import { settingsService } from '../../services/settings/settingsService.svelte';
  import type { UsageShareMode } from '../../services/settings/types/AppSettingsType';
  import { usageShareState } from './usageShareState.svelte';
  import { t } from '../../services/i18n';

  const options: { value: string; label: string; description?: string }[] = [
    { value: 'off', label: 'Off', description: 'Nothing leaves your device.' },
    {
      value: 'ask',
      label: 'Ask me each time',
      description: 'Review the exact data before it is sent.',
    },
    {
      value: 'auto',
      label: 'Share automatically',
      description: 'Send anonymous daily counts in the background.',
    },
  ];

  let mode = $derived(settingsService.currentSettings.privacy.usageShareMode);

  async function choose(value: string) {
    await settingsService.updateSettings('privacy', { usageShareMode: value as UsageShareMode });
  }

  $effect(() => {
    void usageShareState.load();
  });
</script>

<div class="section-header">{t('settings.privacy.section_usage')}</div>
<SettingsCard>
  <SettingsRadioGroup
    label={t('settings.privacy.usage_share')}
    description={t('settings.privacy.usage_share_description')}
    name="usage-share-mode"
    {options}
    value={mode}
    onchange={choose}
  />

  <SettingsRow
    label={t('settings.privacy.anonymous_id')}
    description={t('settings.privacy.anonymous_id_description')}
  >
    <span class="text-mono text-caption">{usageShareState.anonId}</span>
    <Button onclick={() => usageShareState.reset()}>{t('settings.general.reset')}</Button>
  </SettingsRow>
</SettingsCard>
