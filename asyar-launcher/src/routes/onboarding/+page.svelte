<script lang="ts">
  import { onboardingService } from '../../services/onboarding/onboardingService.svelte'
  import StepProgress from '../../components/onboarding/StepProgress.svelte'
  import Welcome from './steps/Welcome.svelte'
  import GrantAccessibility from './steps/GrantAccessibility.svelte'
  import PickHotkey from './steps/PickHotkey.svelte'
  import PickLaunchView from './steps/PickLaunchView.svelte'
  import PickTheme from './steps/PickTheme.svelte'
  import FeaturedExtensions from './steps/FeaturedExtensions.svelte'
  import Done from './steps/Done.svelte'

  const state = $derived(onboardingService.state)
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
</style>
