<script lang="ts">
  import { Button, Icon } from '../../../components';
  import { advanceStep } from '../stepLogic';
  import { onboardingNav } from '../onboardingNav.svelte';
  import { t } from '../../../services/i18n';
  import AccessibilityGate from './AccessibilityGate.svelte';
  import { SAMPLE_PORTAL_NAME, hasSamplePortal, seedSamplePortal } from './portalsSetup';
  import {
    SAMPLE_EXPANSION,
    SAMPLE_KEYWORD,
    hasSampleSnippet,
    seedSampleSnippet,
    enableExpansion,
  } from './snippetsSetup';

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
      sample: {
        preview: `📺 ${SAMPLE_PORTAL_NAME}`,
        tryWhere: t('onboarding.features_portals_try'),
        tryText: SAMPLE_PORTAL_NAME,
      },
    },
    {
      id: 'snippets' as CardId,
      icon: 'snippets',
      title: t('onboarding.snippets_heading'),
      desc: t('onboarding.features_snippets_desc'),
      sample: {
        preview: `${SAMPLE_KEYWORD} → ${SAMPLE_EXPANSION}`,
        tryWhere: t('onboarding.features_snippets_try'),
        tryText: SAMPLE_KEYWORD,
      },
    },
  ]);

  // Samples are opt-in and applied on click; Continue never depends on them.
  const added = $derived<Record<CardId, boolean>>({
    clipboard: true,
    portals: hasSamplePortal(),
    snippets: hasSampleSnippet(),
  });
  let snippetsPending = $state(false);
  let axGranted = $state(false);
  let working = $state(false);
  let error = $state('');

  async function addSnippets() {
    working = true;
    error = '';
    try {
      seedSampleSnippet();
      if (!(await enableExpansion())) error = t('onboarding.snippets_expansion_error');
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      snippetsPending = false;
      working = false;
    }
  }

  function addSample(id: CardId) {
    if (id === 'portals') seedSamplePortal();
    // Expansion needs Accessibility; the gate below finishes the job once it's granted.
    if (id === 'snippets') snippetsPending = true;
  }

  $effect(() => {
    if (snippetsPending && axGranted && !working) void addSnippets();
  });

  $effect(() => {
    onboardingNav.set({ onPrimary: advanceStep });
  });
</script>

<div class="features">
  <div class="features__header">
    <h1 class="features__title">{t('onboarding.features_heading')}</h1>
  </div>

  <div class="features__grid">
    {#each cards as card, i (card.id)}
      <div class="feature" class:feature--on={card.sample && added[card.id]} style:--i={i}>
        <div class="feature__top">
          <span class="feature__icon"><Icon name={card.icon} size={18} /></span>
          {#if card.id === 'clipboard'}
            <span class="feature__always">{t('onboarding.features_always_on')}</span>
          {/if}
        </div>
        <span class="feature__title">{card.title}</span>
        <span class="feature__desc">{card.desc}</span>
        {#if card.sample}
          <div class="feature__sample" aria-live="polite">
            {#if added[card.id]}
              <span class="feature__sample-done">✓ {t('onboarding.features_sample_added')}</span>
              <span class="feature__sample-try">
                {card.sample.tryWhere}
                <kbd class="feature__sample-preview">{card.sample.tryText}</kbd>
              </span>
            {:else}
              <span class="feature__sample-label">{t('onboarding.features_sample_label')}</span>
              <code class="feature__sample-preview">{card.sample.preview}</code>
              <Button
                class="btn-secondary"
                disabled={working || (card.id === 'snippets' && snippetsPending)}
                onclick={() => addSample(card.id)}
              >
                {t('onboarding.features_add_sample')}
              </Button>
            {/if}
          </div>
        {/if}
      </div>
    {/each}
  </div>

  {#if snippetsPending}
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
    margin-bottom: var(--space-3);
  }
  /* Pinned to the card bottom so samples line up across cards. */
  .feature__sample {
    margin-top: auto;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-2);
  }
  .feature__sample-label {
    font-size: var(--font-size-2xs);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-tertiary);
  }
  .feature__sample-preview {
    font-family: var(--font-mono);
    font-size: var(--font-size-xs);
    color: var(--text-primary);
  }
  .feature__sample-done {
    font-size: var(--font-size-sm);
    font-weight: 600;
    color: var(--asyar-brand);
  }
  .feature__sample-try {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
  }
  kbd.feature__sample-preview {
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--separator);
    border-radius: var(--radius-sm);
    background: var(--bg-tertiary);
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
