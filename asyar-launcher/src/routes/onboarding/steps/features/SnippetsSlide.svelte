<script lang="ts">
  import { onMount } from 'svelte';
  import { t } from '../../../../services/i18n';
  import { Button } from '../../../../components';
  import { snippetStore } from '../../../../built-in-features/snippets/snippetStore.svelte';
  import { snippetService } from '../../../../built-in-features/snippets/snippetService';
  import AccessibilityGate from '../AccessibilityGate.svelte';
  import ExpansionField from './ExpansionField.svelte';
  import {
    SAMPLE_EXPANSION,
    SAMPLE_KEYWORD,
    enableExpansion,
    hasSampleSnippet,
    seedSampleSnippet,
  } from '../snippetsSetup';

  let added = $state(false);
  let axGranted = $state(false);
  let enabled = $state(false);
  let error = $state('');

  onMount(async () => {
    await snippetStore.init();
    added = hasSampleSnippet();
  });

  async function addSample() {
    seedSampleSnippet();
    await snippetService.syncToRust();
    added = true;
  }

  // Expanding in other apps needs Accessibility; the field above works without it.
  $effect(() => {
    if (!axGranted || enabled) return;
    void enableExpansion().then((ok) => {
      enabled = ok;
      if (!ok) error = t('onboarding.snippets_expansion_error');
    });
  });
</script>

<ExpansionField
  placeholder={t('onboarding.tour.snippets_placeholder', { keyword: SAMPLE_KEYWORD })}
/>
<div class="snippets-slide__footer">
  {#if added}
    <span class="snippets-slide__sample"><kbd>{SAMPLE_KEYWORD}</kbd> → {SAMPLE_EXPANSION}</span>
  {:else}
    <Button class="btn-secondary" onclick={addSample}>{t('onboarding.tour.snippets_try')}</Button>
  {/if}
  <AccessibilityGate bind:granted={axGranted} />
  {#if error}<p class="snippets-slide__error">{error}</p>{/if}
</div>

<style>
  .snippets-slide__footer {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    border-top: 1px solid var(--separator);
  }
  .snippets-slide__sample {
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
  }
  .snippets-slide__sample kbd {
    font-family: var(--font-mono);
    color: var(--asyar-brand);
  }
  .snippets-slide__error {
    margin: 0;
    color: var(--accent-danger);
    font-size: var(--font-size-sm);
  }
</style>
