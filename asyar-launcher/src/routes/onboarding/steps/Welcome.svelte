<script lang="ts">
  import { emit } from '@tauri-apps/api/event';
  import { advanceStep } from '../stepLogic';
  import { onboardingNav } from '../onboardingNav.svelte';
  import { t } from '../../../services/i18n';

  $effect(() => {
    onboardingNav.set({
      showBack: false,
      primaryLabel: t('onboarding.start_tour'),
      onPrimary: advanceStep,
    });
  });

  const words = $derived(t('onboarding.welcome_headline_pre').split(' '));

  // Onboarding is a separate webview from the main launcher, same as
  // Settings — deep-link into the Tier 1 view via the generic
  // asyar:run-command signal appInitializer.ts listens for.
  async function openRaycastImport() {
    await emit('asyar:run-command', { commandId: 'cmd_raycast-import_import-raycast' });
  }
</script>

<div class="welcome">
  <h1 class="welcome__title">
    {#each words as word, i}
      <span class="welcome__word" style:--i={i}>{word}</span>{' '}
    {/each}
    <span class="welcome__word onb-hl" style:--i={words.length}
      >{t('onboarding.welcome_headline_hl')}</span
    >
  </h1>
  <p class="welcome__tagline" style:--i={words.length + 1}>{t('onboarding.welcome_tagline')}</p>
  <button
    type="button"
    class="welcome__link"
    style:--i={words.length + 3}
    onclick={openRaycastImport}
  >
    {t('onboarding.tour_raycast')}
    {t('settings.backup.import_raycast_button')} →
  </button>
</div>

<style>
  .welcome {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-4);
    text-align: center;
  }
  .welcome__title {
    margin: 0;
    font-size: var(--font-size-display);
    font-weight: 600;
    letter-spacing: -0.5px;
    color: var(--text-primary);
  }
  .welcome__word,
  .welcome__tagline,
  .welcome__link {
    animation: word-in var(--dur-emerge) var(--ease-emerge) both;
    animation-delay: calc(200ms + var(--i) * 70ms);
  }
  .welcome__word {
    display: inline-block;
  }
  .welcome__tagline {
    margin: 0;
    color: var(--text-secondary);
    font-size: var(--font-size-xl);
  }
  .welcome__link {
    background: none;
    border: none;
    padding: 0;
    color: var(--asyar-brand);
    font-size: var(--font-size-md);
    cursor: default;
  }
  .welcome__link:hover {
    color: var(--asyar-brand-hover);
  }

  @keyframes word-in {
    from {
      opacity: 0;
      transform: translateY(12px);
      filter: blur(6px);
    }
  }
</style>
