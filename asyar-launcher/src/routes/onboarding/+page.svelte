<script lang="ts">
  import { t } from '../../services/i18n';
  import { onMount } from 'svelte';
  import { fly } from 'svelte/transition';
  import { cubicIn, cubicOut } from 'svelte/easing';
  import { onboardingService } from '../../services/onboarding/onboardingService.svelte';
  import StepProgress from '../../components/onboarding/StepProgress.svelte';
  import Welcome from './steps/Welcome.svelte';
  import SummonSearch from './steps/SummonSearch.svelte';
  import Features from './steps/Features.svelte';
  import Emoji from './steps/Emoji.svelte';
  import FeaturedExtensions from './steps/FeaturedExtensions.svelte';
  import PickTheme from './steps/PickTheme.svelte';
  import CheatSheet from './steps/CheatSheet.svelte';
  import AiSetupStep from './steps/AiSetupStep.svelte';
  import PrivacyConsent from './steps/PrivacyConsent.svelte';
  import { Button, OnboardingStage } from '../../components';
  import { STEP_GLYPHS } from './stepVisuals';
  import { onboardingNav } from './onboardingNav.svelte';
  import { initValidKeys } from '../../built-in-features/shortcuts/shortcutFormatter';

  const state = $derived(onboardingService.state);
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const nav = $derived(onboardingNav.current);

  // Slide direction follows travel: forward enters from the right, Back from the left.
  let lastPosition = 0;
  const direction = $derived.by(() => {
    const position = state?.position ?? 0;
    const dir = position >= lastPosition ? 1 : -1;
    lastPosition = position;
    return dir;
  });

  // The onboarding window is a separate Tauri webview from the main launcher,
  // so the `VALID_KEYS` module-level set that `ShortcutRecorder` consults
  // starts empty here. Without this init, shortcut-related steps would reject
  // every keypress as "invalid key" because the set has no entries to validate
  // against. The main launcher and the settings window each init this set
  // themselves; onboarding has to too.
  onMount(() => {
    void initValidKeys();
  });
</script>

{#if state}
  <div class="onboarding-stage">
    <div class="onboarding-stage__viewport">
      {#key state.current}
        <div
          class="onboarding-stage__step custom-scrollbar"
          in:fly={reduceMotion
            ? { duration: 0 }
            : { x: 32 * direction, duration: 360, delay: 140, easing: cubicOut }}
          out:fly={reduceMotion
            ? { duration: 0 }
            : { x: -32 * direction, duration: 160, easing: cubicIn }}
        >
          <OnboardingStage glyph={STEP_GLYPHS[state.current]} />
          <div class="onboarding-stage__body">
            {#if state.current === 'welcome'}
              <Welcome />
            {:else if state.current === 'summonSearch'}
              <SummonSearch />
            {:else if state.current === 'features'}
              <Features />
            {:else if state.current === 'emoji'}
              <Emoji />
            {:else if state.current === 'aiSetup'}
              <AiSetupStep />
            {:else if state.current === 'pickTheme'}
              <PickTheme />
            {:else if state.current === 'featuredExtensions'}
              <FeaturedExtensions />
            {:else if state.current === 'privacyConsent'}
              <PrivacyConsent />
            {:else if state.current === 'cheatSheet'}
              <CheatSheet />
            {/if}
          </div>
        </div>
      {/key}
    </div>
    <div class="onboarding-stage__footer">
      <div class="onboarding-stage__footer-left">
        {#if nav.showBack}
          <Button class="btn-secondary" onclick={nav.onBack}>{t('common.back')}</Button>
        {/if}
      </div>
      <StepProgress total={state.total} position={state.position} />
      <div class="onboarding-stage__footer-right">
        {#if nav.showSkip}
          <Button class="btn-secondary" onclick={nav.onSkip}
            >{nav.skipLabel}<kbd class="onboarding-stage__key">{state.isMacos ? '⌘' : 'Ctrl'} ↵</kbd
            ></Button
          >
        {/if}
        <Button onclick={nav.onPrimary} disabled={nav.primaryDisabled}
          >{nav.primaryLabel}<kbd class="onboarding-stage__key">↵</kbd></Button
        >
      </div>
    </div>
  </div>
{:else}
  <p>{t('common.loading')}</p>
{/if}

<style>
  .onboarding-stage {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-5);
    padding: var(--space-7) var(--space-6) var(--space-5);
    /* fill the flex parent (`__main`) rather than a fragile percentage height */
    flex: 1;
    min-height: 0;
    overflow: hidden;
    --onb-content-width: 640px;
  }
  /* Outgoing and incoming steps share one grid cell so the slide never reflows. */
  .onboarding-stage__viewport {
    flex: 1;
    min-height: 0;
    width: 100%;
    display: grid;
  }
  .onboarding-stage__step {
    grid-area: 1 / 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: safe center;
    gap: var(--space-6);
    padding: var(--space-6) 0;
  }
  .onboarding-stage__body {
    width: 100%;
    max-width: var(--onb-content-width);
    animation: body-rise var(--dur-emerge) var(--ease-emerge) 120ms both;
  }

  .onboarding-stage__footer {
    width: 100%;
    max-width: var(--onb-content-width);
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    gap: var(--space-2);
    padding-top: var(--space-4);
    border-top: 1px solid var(--separator);
  }
  .onboarding-stage__footer-left {
    display: flex;
  }
  .onboarding-stage__footer-right {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
  }
  .onboarding-stage__key {
    margin-left: var(--space-2);
    font-family: inherit;
    font-size: var(--font-size-xs);
    opacity: 0.6;
  }

  @keyframes body-rise {
    from {
      opacity: 0;
      transform: translateY(var(--space-4));
    }
  }
</style>
