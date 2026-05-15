<script lang="ts">
  import { onboardingService } from '../../services/onboarding/onboardingService.svelte'
  import { diagnosticsService } from '../../services/diagnostics/diagnosticsService.svelte'
  import StepProgress from '../../components/onboarding/StepProgress.svelte'
  import Welcome from './steps/Welcome.svelte'
  import GrantAccessibility from './steps/GrantAccessibility.svelte'
  import PickHotkey from './steps/PickHotkey.svelte'
  import PickLaunchView from './steps/PickLaunchView.svelte'
  import PickTheme from './steps/PickTheme.svelte'
  import FeaturedExtensions from './steps/FeaturedExtensions.svelte'
  import Done from './steps/Done.svelte'
  import AiTab from '../settings/tabs/AiTab.svelte'
  import { Button } from '../../components'

  const state = $derived(onboardingService.state)

  async function handleAiSetupDone() {
    try {
      await onboardingService.completeAi()
    } catch {
      // completeAi already reports via diagnosticsService
    }
    await onboardingService.advance()
  }

  async function handleAiSkip() {
    try {
      await onboardingService.skipAiSetup()
    } catch (err) {
      diagnosticsService.report({
        source: 'frontend',
        kind: 'manual',
        severity: 'warning',
        retryable: false,
        context: { message: 'Could not skip AI setup.' },
        developerDetail: String(err),
      })
    }
  }
</script>

{#if state}
  <div class="onboarding-page">
    <StepProgress total={state.total} position={state.position} />
    {#if state.current === 'welcome'}
      <Welcome />
    {:else if state.current === 'grantAccessibility'}
      <GrantAccessibility />
    {:else if state.current === 'pickHotkey'}
      <PickHotkey />
    {:else if state.current === 'pickLaunchView'}
      <PickLaunchView />
    {:else if state.current === 'pickTheme'}
      <PickTheme />
    {:else if state.current === 'featuredExtensions'}
      <FeaturedExtensions />
    {:else if state.current === 'aiSetup'}
      <div class="ai-step">
        <AiTab mode="providers-only" />
        <div class="ai-step-actions">
          <Button onclick={handleAiSkip}>Skip for now</Button>
          <Button onclick={handleAiSetupDone}>Continue</Button>
        </div>
      </div>
    {:else if state.current === 'done'}
      <Done />
    {/if}
  </div>
{:else}
  <p>Loading…</p>
{/if}

<style>
  .onboarding-page {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
  }

  .ai-step {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .ai-step-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
  }
</style>
