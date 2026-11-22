<script lang="ts">
  import { SegmentedControl, SystemAccessSection } from '../../../components';
  import { settingsService } from '../../../services/settings/settingsService.svelte';
  import { advanceStep } from '../stepLogic';
  import { onboardingNav } from '../onboardingNav.svelte';
  import type {
    CrashReportMode,
    UsageShareMode,
  } from '../../../services/settings/types/AppSettingsType';
  import { t } from '../../../services/i18n';

  let crashMode = $state<CrashReportMode>(settingsService.currentSettings.privacy.crashReportMode);
  let usageMode = $state<UsageShareMode>(settingsService.currentSettings.privacy.usageShareMode);

  const options = $derived([
    { value: 'off', label: t('settings.privacy.mode_off') },
    { value: 'ask', label: t('onboarding.privacy_ask') },
    { value: 'auto', label: t('onboarding.privacy_auto') },
  ]);

  $effect(() => {
    onboardingNav.set({ showSkip: false, onPrimary: advanceStep });
  });
</script>

<div class="privacy">
  <h1 class="privacy__title">{t('onboarding.privacy_heading')}</h1>
  <div class="privacy__rows">
    <div class="privacy__row">
      <div class="privacy__text">
        <span class="privacy__label">{t('settings.privacy.crash_reports')}</span>
        <span class="privacy__desc">{t(`settings.privacy.crash_${crashMode}_desc`)}</span>
      </div>
      <SegmentedControl
        {options}
        bind:value={crashMode}
        onchange={(v) =>
          settingsService.updateSettings('privacy', { crashReportMode: v as CrashReportMode })}
      />
    </div>
    <div class="privacy__row">
      <div class="privacy__text">
        <span class="privacy__label">{t('settings.privacy.usage_share')}</span>
        <span class="privacy__desc">{t(`settings.privacy.usage_${usageMode}_desc`)}</span>
      </div>
      <SegmentedControl
        {options}
        bind:value={usageMode}
        onchange={(v) =>
          settingsService.updateSettings('privacy', { usageShareMode: v as UsageShareMode })}
      />
    </div>
  </div>
  <p class="privacy__note">{t('onboarding.privacy_note')}</p>
  <div class="privacy__access">
    <SystemAccessSection />
  </div>
</div>

<style>
  .privacy {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-5);
  }
  .privacy__title {
    margin: 0;
    font-size: var(--font-size-display);
    font-weight: 600;
    letter-spacing: -0.5px;
    color: var(--text-primary);
  }
  .privacy__rows {
    width: 100%;
    max-width: 480px;
    display: flex;
    flex-direction: column;
  }
  .privacy__row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    padding: var(--space-3) 0;
    border-bottom: 1px solid var(--separator);
  }
  .privacy__row:last-child {
    border-bottom: none;
  }
  .privacy__text {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
  }
  .privacy__desc {
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
  }
  .privacy__label {
    font-size: var(--font-size-md);
    font-weight: 600;
    color: var(--text-primary);
  }
  .privacy__access {
    width: 100%;
    max-width: 480px;
  }
  .privacy__note {
    margin: 0;
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
  }
</style>
