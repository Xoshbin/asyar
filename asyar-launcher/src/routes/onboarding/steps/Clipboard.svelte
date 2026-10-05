<script lang="ts">
  import { GuidanceStep, LauncherHint } from '../../../components';
  import { settingsService } from '../../../services/settings/settingsService.svelte';
  import { advanceStep } from '../stepLogic';
  import { onboardingNav } from '../onboardingNav.svelte';
  import { t } from '../../../services/i18n';

  const mod = $derived(settingsService.currentSettings.shortcut.modifier);
  const key = $derived(settingsService.currentSettings.shortcut.key);

  $effect(() => {
    onboardingNav.set({ showSkip: true, onPrimary: advanceStep, onSkip: advanceStep });
  });
</script>

<GuidanceStep kicker={t('onboarding.clipboard_kicker')} title={t('features.clipboard.title')}>
  {#snippet body()}
    <p>{t('onboarding.clipboard_desc')}</p>
    <LauncherHint
      steps={[
        t('onboarding.hint_press_shortcut', { shortcut: `${mod}+${key}` }),
        t('onboarding.clipboard_hint_type'),
        t('onboarding.clipboard_hint_pick'),
      ]}
    />
    <p>
      {t('onboarding.clipboard_multi_pre')}
      <span class="onb-hl">{t('onboarding.clipboard_multi_hl')}</span>.
    </p>
  {/snippet}
</GuidanceStep>
