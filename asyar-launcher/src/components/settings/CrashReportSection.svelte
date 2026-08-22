<script lang="ts">
  import { SettingsCard } from '../index';
  import SettingsRadioGroup from './SettingsRadioGroup.svelte';
  import { settingsService } from '../../services/settings/settingsService.svelte';
  import type { CrashReportMode } from '../../services/settings/types/AppSettingsType';
  import { t } from '../../services/i18n';

  const options: { value: string; label: string; description?: string }[] = [
    { value: 'off', label: 'Off', description: 'Never send anything.' },
    {
      value: 'ask',
      label: 'Ask me each time',
      description: 'Preview the exact report before sending.',
    },
    { value: 'auto', label: 'Send automatically', description: 'Send crash reports silently.' },
  ];

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
