<script lang="ts">
  import { SettingsCard, SettingsRow, SettingsRadioGroup, Button } from '../index';
  import { settingsService } from '../../services/settings/settingsService.svelte';
  import type { UsageShareMode } from '../../services/settings/types/AppSettingsType';
  import { usageShareState } from './usageShareState.svelte';
  import { t } from '../../services/i18n';

  let options = $derived<{ value: string; label: string; description?: string }[]>([
    {
      value: 'off',
      label: t('settings.privacy.mode_off'),
      description: t('settings.privacy.usage_off_desc'),
    },
    {
      value: 'ask',
      label: t('settings.privacy.mode_ask'),
      description: t('settings.privacy.usage_ask_desc'),
    },
    {
      value: 'auto',
      label: t('settings.privacy.mode_share_auto'),
      description: t('settings.privacy.usage_auto_desc'),
    },
  ]);

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
