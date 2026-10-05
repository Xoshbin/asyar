<script lang="ts">
  import { Card, Button, ExpansionDemo } from '../../../components';
  import { advanceStep } from '../stepLogic';
  import AccessibilityGate from './AccessibilityGate.svelte';
  import { seedSampleSnippet, enableExpansion } from './snippetsSetup';
  import { onboardingNav } from '../onboardingNav.svelte';
  import { t } from '../../../services/i18n';

  let seeded = $state(false);
  let enabled = $state(false);
  let axGranted = $state(false);
  let working = $state(false);
  let error = $state('');

  $effect(() => {
    onboardingNav.set({
      primaryLabel: seeded ? t('onboarding.continue') : t('onboarding.skip'),
      onPrimary: advanceStep,
    });
  });

  async function setUp() {
    working = true;
    error = '';
    try {
      seedSampleSnippet();
      seeded = true;
      const ok = await enableExpansion();
      if (!ok) {
        error = t('onboarding.snippets_expansion_error');
      } else {
        enabled = true;
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      working = false;
    }
  }
</script>

<Card>
  <div class="step">
    <p class="step__kicker">{t('onboarding.snippets_title')}</p>
    <h1 class="step__title"><span class="onb-hl">{t('onboarding.snippets_heading')}</span></h1>
    <p class="step__lede">
      {t('onboarding.snippets_desc')}
    </p>

    <div class="step__setup">
      <span class="step__label"
        >{t('onboarding.step_num', { n: 1, label: t('onboarding.permission') })}</span
      >
      <AccessibilityGate bind:granted={axGranted} />
      <Button onclick={setUp} disabled={working || (seeded && enabled)}>
        {seeded && enabled
          ? t('onboarding.snippets_sample_ready')
          : working
            ? t('onboarding.setting_up')
            : t('onboarding.step_num', { n: 2, label: t('onboarding.snippets_add_sample') })}
      </Button>
      {#if error}<p class="step__error">{error}</p>{/if}
    </div>

    <ExpansionDemo trigger=";email" result="you@example.com" note={t('onboarding.snippets_note')} />
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
  .step__setup {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .step__label {
    font-size: var(--font-size-sm);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-secondary);
  }
  .step__error {
    margin: var(--space-2) 0 0;
    color: var(--accent-danger);
    font-size: var(--font-size-md);
  }
</style>
