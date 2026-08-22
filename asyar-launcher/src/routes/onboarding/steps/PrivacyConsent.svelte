<script lang="ts">
  import { GuidanceStep, SettingsRadioGroup } from '../../../components';
  import { settingsService } from '../../../services/settings/settingsService.svelte';
  import { advanceStep } from '../stepLogic';
  import { onboardingNav } from '../onboardingNav.svelte';
  import type {
    CrashReportMode,
    UsageShareMode,
  } from '../../../services/settings/types/AppSettingsType';

  import { t } from '../../../services/i18n';

  let mode = $state<CrashReportMode>(settingsService.currentSettings.privacy.crashReportMode);

  let options = $derived<{ value: CrashReportMode; label: string; description?: string }[]>([
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

  function handleChange(value: string) {
    void settingsService.updateSettings('privacy', { crashReportMode: value as CrashReportMode });
  }

  let usageMode = $state<UsageShareMode>(settingsService.currentSettings.privacy.usageShareMode);

  let usageOptions = $derived<{ value: UsageShareMode; label: string; description?: string }[]>([
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
      label: t('settings.privacy.mode_share_anon'),
      description: t('settings.privacy.usage_anon_desc'),
    },
  ]);

  function handleUsageChange(value: string) {
    void settingsService.updateSettings('privacy', { usageShareMode: value as UsageShareMode });
  }

  $effect(() => {
    onboardingNav.set({ showSkip: false, onPrimary: advanceStep });
  });
</script>

<GuidanceStep kicker={t('onboarding.privacy_title')} title={t('onboarding.privacy_heading')}>
  {#snippet body()}
    <p>
      {t('onboarding.privacy_desc')}
    </p>
    <SettingsRadioGroup
      name="crashReportMode"
      {options}
      bind:value={mode}
      onchange={handleChange}
      noBorder={true}
    />
    <p class="text-section">{t('onboarding.anonymous_usage')}</p>
    <p>
      {t('onboarding.anonymous_usage_desc')}
    </p>
    <SettingsRadioGroup
      name="usageShareMode"
      options={usageOptions}
      bind:value={usageMode}
      onchange={handleUsageChange}
      noBorder={true}
    />
  {/snippet}
</GuidanceStep>
