<script lang="ts">
  import { SettingsCard } from '../index';
  import SettingsRadioGroup from './SettingsRadioGroup.svelte';
  import { settingsService } from '../../services/settings/settingsService.svelte';
  import type { CrashReportMode } from '../../services/settings/types/AppSettingsType';
  import { t } from '../../services/i18n';

  let options = $derived<{ value: string; label: string; description?: string }[]>([
    {
      value: 'off',
      label: t('settings.privacy.mode_off'),
      description: t('settings.privacy.crash_off_desc'),
    },
    {
      value: 'ask',
      label: t('settings.privacy.mode_ask'),
      description: t('settings.privacy.crash_ask_desc'),
    },
    {
      value: 'auto',
      label: t('settings.privacy.mode_auto'),
      description: t('settings.privacy.crash_auto_desc'),
    },
  ]);

  let mode = $derived(settingsService.currentSettings.privacy.crashReportMode);

  async function choose(value: string) {
    await settingsService.updateSettings('privacy', { crashReportMode: value as CrashReportMode });
  }
</script>

<div class="section-header">{t('settings.privacy.crash_reports')}</div>
<SettingsCard>
  <SettingsRadioGroup
    label={t('settings.privacy.crash_reports')}
    description={t('settings.privacy.crash_reports_desc')}
    name="crash-report-mode"
    {options}
    value={mode}
    onchange={choose}
    noBorder
  />
</SettingsCard>
