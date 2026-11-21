<script lang="ts">
  import { Icon, Toggle } from '../../../components';
  import { advanceStep } from '../stepLogic';
  import { onboardingNav } from '../onboardingNav.svelte';
  import { t } from '../../../services/i18n';
  import AccessibilityGate from './AccessibilityGate.svelte';
  import { seedSamplePortal } from './portalsSetup';
  import { seedSampleSnippet, enableExpansion } from './snippetsSetup';

  type CardId = 'clipboard' | 'portals' | 'snippets';

  const cards = $derived([
    {
      id: 'clipboard' as CardId,
      icon: 'clipboard',
      title: t('features.clipboard.title'),
      desc: t('onboarding.features_clipboard_desc'),
    },
    {
      id: 'portals' as CardId,
      icon: 'globe',
      title: t('onboarding.portals_heading'),
      desc: t('onboarding.features_portals_desc'),
    },
    {
      id: 'snippets' as CardId,
      icon: 'snippets',
      title: t('onboarding.snippets_heading'),
      desc: t('onboarding.features_snippets_desc'),
    },
  ]);

  // Everything is opt-in: nothing is set up until the user switches it on and continues.
  let enabled = $state<Record<CardId, boolean>>({
    clipboard: true,
    portals: false,
    snippets: false,
  });
  let axGranted = $state(false);
  let working = $state(false);
  let error = $state('');

  const needsAx = $derived(enabled.snippets);

  async function apply() {
    working = true;
    error = '';
    try {
      if (enabled.portals) seedSamplePortal();
      if (enabled.snippets) {
        seedSampleSnippet();
        if (!(await enableExpansion())) {
          error = t('onboarding.snippets_expansion_error');
          return;
        }
      }
      await advanceStep();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      working = false;
    }
  }

  $effect(() => {
    onboardingNav.set({
      showSkip: true,
      onSkip: advanceStep,
      primaryLabel: working ? t('onboarding.setting_up') : t('onboarding.continue'),
      primaryDisabled: working || (needsAx && !axGranted),
      onPrimary: apply,
    });
  });
</script>

<div class="features">
  <div class="features__header">
    <h1 class="features__title">{t('onboarding.features_heading')}</h1>
  </div>

  <div class="features__grid">
    {#each cards as card, i (card.id)}
      <div class="feature" class:feature--on={enabled[card.id]} style:--i={i}>
        <div class="feature__top">
          <span class="feature__icon"><Icon name={card.icon} size={18} /></span>
          {#if card.id === 'clipboard'}
            <span class="feature__always">{t('onboarding.features_always_on')}</span>
          {:else}
            <Toggle bind:checked={enabled[card.id]} disabled={working} title={card.title} />
          {/if}
        </div>
        <span class="feature__title">{card.title}</span>
        <span class="feature__desc">{card.desc}</span>
      </div>
    {/each}
  </div>

  {#if needsAx}
    <AccessibilityGate bind:granted={axGranted} />
  {/if}
  {#if error}<p class="features__error">{error}</p>{/if}
</div>

<style>
  .features {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }
  .features__header {
    text-align: center;
  }
  .features__title {
    margin: 0;
    font-size: var(--font-size-display);
    font-weight: 600;
    letter-spacing: -0.5px;
    color: var(--text-primary);
  }
  .features__grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--space-3);
  }
  .feature {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-4);
    background: var(--bg-secondary);
    border: 1px solid var(--separator);
    border-radius: var(--radius-lg);
    transition:
      border-color var(--dur-quick) var(--ease-travel),
      background var(--dur-quick) var(--ease-travel);
    animation: card-in var(--dur-emerge) var(--ease-emerge) both;
    animation-delay: calc(160ms + var(--i) * 60ms);
  }
  .feature--on {
    border-color: color-mix(in srgb, var(--asyar-brand) 55%, transparent);
    background: color-mix(in srgb, var(--asyar-brand) 8%, var(--bg-secondary));
  }
  .feature__icon {
    display: grid;
    place-items: center;
    flex-shrink: 0;
    width: 32px;
    height: 32px;
    border-radius: var(--radius-md);
    color: var(--asyar-brand);
    background: var(--asyar-brand-muted);
  }
  .feature__top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: var(--space-2);
  }
  .feature__title {
    font-size: var(--font-size-md);
    font-weight: 600;
    color: var(--text-primary);
  }
  .feature__desc {
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
    line-height: 1.5;
  }
  .feature__always {
    font-size: var(--font-size-2xs);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--asyar-brand);
    white-space: nowrap;
  }
  .features__error {
    margin: 0;
    color: var(--accent-danger);
    font-size: var(--font-size-md);
  }

  @keyframes card-in {
    from {
      opacity: 0;
      transform: translateY(12px) scale(0.97);
    }
  }
</style>
