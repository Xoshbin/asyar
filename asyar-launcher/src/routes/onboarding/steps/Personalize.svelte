<script lang="ts">
  import { fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { SegmentedControl } from '../../../components';
  import { t } from '../../../services/i18n';
  import PickTheme from './PickTheme.svelte';
  import FeaturedExtensions from './FeaturedExtensions.svelte';
  import PrivacyOptions from './PrivacyOptions.svelte';
  import { onboardingNav } from '../onboardingNav.svelte';

  // Theme, extensions and privacy share one step; each tab's Continue opens the next tab.
  let tab = $state('theme');
  const ORDER = ['theme', 'extensions', 'privacy'];
  // Slide in from the side of travel, like the steps themselves.
  let lastIndex = 0;
  const direction = $derived.by(() => {
    const i = ORDER.indexOf(tab);
    const dir = i >= lastIndex ? 1 : -1;
    lastIndex = i;
    return dir;
  });

  $effect(() => {
    if (tab !== 'privacy') return;
    onboardingNav.set({
      glyph: 'lock',
      onBack: () => {
        tab = 'extensions';
      },
    });
  });

  const options = $derived([
    { value: 'theme', label: t('onboarding.personalize_theme') },
    { value: 'extensions', label: t('onboarding.personalize_extensions') },
    { value: 'privacy', label: t('onboarding.personalize_privacy') },
  ]);
</script>

<div class="personalize">
  <div class="personalize__tabs">
    <SegmentedControl {options} bind:value={tab} />
  </div>
  {#key tab}
    <div class="personalize__pane" in:fly={{ x: 24 * direction, duration: 260, easing: cubicOut }}>
      {#if tab === 'theme'}
        <PickTheme
          onDone={() => {
            tab = 'extensions';
          }}
        />
      {:else if tab === 'extensions'}
        <FeaturedExtensions
          onDone={() => {
            tab = 'privacy';
          }}
          onBack={() => {
            tab = 'theme';
          }}
        />
      {:else}
        <PrivacyOptions />
      {/if}
    </div>
  {/key}
</div>

<style>
  .personalize {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
  }
  .personalize__tabs {
    display: flex;
    justify-content: center;
  }
</style>
