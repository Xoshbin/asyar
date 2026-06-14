<script lang="ts">
  import { SettingsSection } from '../index';
  import SettingsRadioGroup from './SettingsRadioGroup.svelte';
  import { settingsService } from '../../services/settings/settingsService.svelte';
  import type { CrashReportMode } from '../../services/settings/types/AppSettingsType';

  const options: { value: string; label: string; description?: string }[] = [
    { value: 'off', label: 'Off', description: 'Never send anything.' },
    { value: 'ask', label: 'Ask me each time', description: 'Preview the exact report before sending.' },
    { value: 'auto', label: 'Send automatically', description: 'Send crash reports silently.' },
  ];

  let mode = $derived(settingsService.currentSettings.privacy.crashReportMode);

  async function choose(value: string) {
    await settingsService.updateSettings('privacy', { crashReportMode: value as CrashReportMode });
  }
</script>

<SettingsSection
  title="Crash & Error Reports"
  description="Asyar sends no telemetry by default. Opt in to help fix crashes — you choose how."
>
  <SettingsRadioGroup
    name="crash-report-mode"
    {options}
    value={mode}
    onchange={choose}
    noBorder
  />
</SettingsSection>
