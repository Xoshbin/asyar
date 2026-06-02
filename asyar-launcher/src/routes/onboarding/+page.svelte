<script lang="ts">
  import { onMount } from 'svelte'
  import { onboardingService } from '../../services/onboarding/onboardingService.svelte'
  import StepProgress from '../../components/onboarding/StepProgress.svelte'
  import Welcome from './steps/Welcome.svelte'
  import SummonSearch from './steps/SummonSearch.svelte'
  import Clipboard from './steps/Clipboard.svelte'
  import Portals from './steps/Portals.svelte'
  import HiddenCommands from './steps/HiddenCommands.svelte'
  import Emoji from './steps/Emoji.svelte'
  import Snippets from './steps/Snippets.svelte'
  import FeaturedExtensions from './steps/FeaturedExtensions.svelte'
  import PickTheme from './steps/PickTheme.svelte'
  import CheatSheet from './steps/CheatSheet.svelte'
  import AiSetupStep from './steps/AiSetupStep.svelte'
  import { Button, OnboardingStage } from '../../components'
  import { STEP_VISUALS } from './stepVisuals'
  import { onboardingNav } from './onboardingNav.svelte'
  import { initValidKeys } from '../../built-in-features/shortcuts/shortcutFormatter'

  const state = $derived(onboardingService.state)
  const nav = $derived(onboardingNav.current)

  // The onboarding window is a separate Tauri webview from the main launcher,
  // so the `VALID_KEYS` module-level set that `ShortcutRecorder` consults
  // starts empty here. Without this init, shortcut-related steps would reject
  // every keypress as "invalid key" because the set has no entries to validate
  // against. The main launcher and the settings window each init this set
  // themselves; onboarding has to too.
  onMount(() => {
    void initValidKeys()
  })

</script>

{#if state}
  {@const visual = STEP_VISUALS[state.current]}
  <div class="onboarding-stage">
    <div class="onboarding-stage__content">
      <StepProgress total={state.total} position={state.position} />
      <div class="onboarding-stage__body custom-scrollbar">
        {#if state.current === 'welcome'}
          <Welcome />
        {:else if state.current === 'summonSearch'}
          <SummonSearch />
        {:else if state.current === 'clipboard'}
          <Clipboard />
        {:else if state.current === 'portals'}
          <Portals />
        {:else if state.current === 'aiSetup'}
          <AiSetupStep />
        {:else if state.current === 'hiddenCommands'}
          <HiddenCommands />
        {:else if state.current === 'emoji'}
          <Emoji />
        {:else if state.current === 'snippets'}
          <Snippets />
        {:else if state.current === 'featuredExtensions'}
          <FeaturedExtensions />
        {:else if state.current === 'pickTheme'}
          <PickTheme />
        {:else if state.current === 'cheatSheet'}
          <CheatSheet />
        {/if}
      </div>
      <div class="onboarding-stage__footer">
        {#if nav.showBack}
          <Button class="btn-secondary" onclick={nav.onBack}>Back</Button>
        {:else}
          <span></span>
        {/if}
        <div class="onboarding-stage__footer-right">
          {#if nav.showSkip}
            <Button class="btn-secondary" onclick={nav.onSkip}>{nav.skipLabel}</Button>
          {/if}
          <Button onclick={nav.onPrimary} disabled={nav.primaryDisabled}>{nav.primaryLabel}</Button>
        </div>
      </div>
    </div>
    <OnboardingStage image={visual.image} lean={visual.lean} />
  </div>
{:else}
  <p>Loading…</p>
{/if}

<style>
  .onboarding-stage {
    display: grid;
    grid-template-columns: 1.02fr 0.98fr;
    /* fill the flex parent (`__main`) rather than a fragile percentage height */
    flex: 1;
    min-height: 0;
  }
  .onboarding-stage__content {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
    padding: var(--space-7) var(--space-6);
    overflow: hidden;
    min-height: 0;
  }

  .onboarding-stage__body {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    justify-content: safe center;
    overflow-y: auto;
  }

  .onboarding-stage__footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--space-2);
    padding-top: var(--space-4);
    border-top: 1px solid var(--separator);
  }
  .onboarding-stage__footer-right { display: flex; gap: var(--space-2); }
</style>
