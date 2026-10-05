<script lang="ts">
  import { t } from '../../../services/i18n';
  import { Card, Button, LauncherHint } from '../../../components';
  import { advanceStep } from '../stepLogic';
  import { settingsService } from '../../../services/settings/settingsService.svelte';
  import { seedSamplePortal } from './portalsSetup';
  import { onboardingNav } from '../onboardingNav.svelte';

  $effect(() => {
    onboardingNav.set({ showSkip: true, onPrimary: advanceStep, onSkip: advanceStep });
  });

  const mod = $derived(settingsService.currentSettings.shortcut.modifier);
  const key = $derived(settingsService.currentSettings.shortcut.key);
  let seeded = $state(false);

  function addSample() {
    seedSamplePortal();
    seeded = true;
  }
</script>

<Card>
  <div class="step">
    <p class="step__kicker">{t('onboarding.portals_kicker')}</p>
    <h1 class="step__title"><span class="onb-hl">{t('onboarding.portals_heading')}</span></h1>
    <p class="step__lede">
      {t('onboarding.portals_desc_pre')} <code>{'{query}'}</code>
      {t('onboarding.portals_desc_post')}
    </p>

    <Button class="btn-secondary" onclick={addSample} disabled={seeded}>
      {seeded ? t('onboarding.portals_sample_added') : t('onboarding.portals_add_sample')}
    </Button>

    <LauncherHint
      steps={[
        t('onboarding.hint_press_shortcut', { shortcut: `${mod}+${key}` }),
        t('onboarding.portals_hint_type'),
        t('onboarding.portals_hint_tab'),
      ]}
    />
  </div>
</Card>

<style>
  .step {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .step__kicker {
    margin: 0;
    font-size: var(--font-size-sm);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--asyar-brand);
  }
  .step__title {
    margin: 0;
    font-size: var(--font-size-display);
    font-weight: 600;
    letter-spacing: -0.5px;
    color: var(--text-primary);
  }
  .step__lede {
    margin: 0;
    color: var(--text-secondary);
    font-size: var(--font-size-xl);
    line-height: 1.6;
  }
  .step__lede code {
    background: var(--bg-tertiary);
    border: 1px solid var(--separator);
    border-radius: var(--radius-md);
    padding: 0 var(--space-2);
  }
</style>
