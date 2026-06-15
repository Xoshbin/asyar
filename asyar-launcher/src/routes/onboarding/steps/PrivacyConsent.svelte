<script lang="ts">
  import { GuidanceStep, SettingsRadioGroup } from '../../../components'
  import { settingsService } from '../../../services/settings/settingsService.svelte'
  import { advanceStep } from '../stepLogic'
  import { onboardingNav } from '../onboardingNav.svelte'
  import type { CrashReportMode, UsageShareMode } from '../../../services/settings/types/AppSettingsType'

  let mode = $state<CrashReportMode>(
    settingsService.currentSettings.privacy.crashReportMode
  )

  const options: { value: CrashReportMode; label: string; description?: string }[] = [
    {
      value: 'off',
      label: 'Off',
      description: 'No crash data is sent. Nothing leaves your device.',
    },
    {
      value: 'ask',
      label: 'Ask each time',
      description: 'You review each crash report before it is sent.',
    },
    {
      value: 'auto',
      label: 'Send automatically',
      description: 'Reports are sent in the background so you never see a prompt.',
    },
  ]

  function handleChange(value: string) {
    void settingsService.updateSettings('privacy', { crashReportMode: value as CrashReportMode })
  }

  let usageMode = $state<UsageShareMode>(
    settingsService.currentSettings.privacy.usageShareMode
  )

  const usageOptions: { value: UsageShareMode; label: string; description?: string }[] = [
    {
      value: 'off',
      label: 'Off',
      description: 'No usage data is shared.',
    },
    {
      value: 'ask',
      label: 'Ask each time',
      description: 'You review each share.',
    },
    {
      value: 'auto',
      label: 'Share anonymously',
      description: 'Daily counts, no personal data.',
    },
  ]

  function handleUsageChange(value: string) {
    void settingsService.updateSettings('privacy', { usageShareMode: value as UsageShareMode })
  }

  $effect(() => {
    onboardingNav.set({ showSkip: false, onPrimary: advanceStep })
  })
</script>

<GuidanceStep kicker="Help improve Asyar" title="Privacy choices">
  {#snippet body()}
    <p>When Asyar crashes, it can send a small report so the team can fix the problem faster.
       You are always in control — choose what feels right for you.</p>
    <SettingsRadioGroup
      name="crashReportMode"
      {options}
      bind:value={mode}
      onchange={handleChange}
      noBorder={true}
    />
    <p class="text-section">Anonymous usage share (optional)</p>
    <p>Share anonymous daily counts of which commands you run. No search text, no file paths, no personal data.</p>
    <SettingsRadioGroup
      name="usageShareMode"
      options={usageOptions}
      bind:value={usageMode}
      onchange={handleUsageChange}
      noBorder={true}
    />
  {/snippet}
</GuidanceStep>
