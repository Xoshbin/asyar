<script lang="ts">
  import { onMount } from 'svelte';
  import { t } from '../../../../services/i18n';
  import { Button } from '../../../../components';
  import { agentService } from '../../../../built-in-features/agents/agentService.svelte';
  import { dispatchSilentAgentCommand } from '../../../../built-in-features/agents/silentDispatch';
  import { shortcutStore } from '../../../../built-in-features/shortcuts/shortcutStore.svelte';
  import { toDisplayKeys } from '../../../../built-in-features/shortcuts/shortcutFormatter';
  import { goBackStep } from '../../stepLogic';
  import TypingDemo from './TypingDemo.svelte';
  import { GRAMMAR_FIX_AGENT_ID, GRAMMAR_FIX_OBJECT_ID } from './featureTour';

  let loaded = $state(false);
  let text = $state(t('onboarding.tour.ai_sample'));
  let running = $state(false);

  onMount(async () => {
    await Promise.all([agentService.init(), shortcutStore.init()]);
    loaded = true;
  });

  const provider = $derived(loaded ? agentService.getDefaultAgent() : null);
  const hotkey = $derived(
    loaded ? shortcutStore.getByObjectId(GRAMMAR_FIX_OBJECT_ID)?.shortcut : undefined,
  );

  // Runs the real Grammar Fix agent on this field: a global hotkey can't read a selection inside Asyar itself.
  async function fix() {
    if (!provider || !text.trim()) return;
    running = true;
    try {
      const agent =
        agentService.getById(GRAMMAR_FIX_AGENT_ID) ??
        (await agentService.seedGrammarFixAgent(provider.providerId, provider.modelId));
      await dispatchSilentAgentCommand({
        agentId: agent.id,
        userText: text,
        skipOutputAction: true,
        onFinalText: (result) => {
          if (result.trim()) text = result.trim();
        },
      });
    } finally {
      running = false;
    }
  }
</script>

{#if provider}
  <textarea class="ai-slide__field" bind:value={text} disabled={running}></textarea>
  <div class="ai-slide__footer">
    <Button onclick={fix} disabled={running}>
      {running ? t('onboarding.tour.ai_fixing') : t('onboarding.tour.ai_fix')}
    </Button>
    {#if hotkey}
      <span class="ai-slide__hint">
        {t('onboarding.tour.ai_anywhere')}
        {#each toDisplayKeys(hotkey) as key, i (i)}<kbd>{key}</kbd>{/each}
      </span>
    {/if}
  </div>
{:else}
  <TypingDemo before={t('onboarding.tour.ai_sample')} after={t('onboarding.tour.ai_fixed')} />
  {#if loaded}
    <div class="ai-slide__footer">
      <span class="ai-slide__hint">{t('onboarding.tour.ai_not_connected')}</span>
      <Button class="btn-secondary" onclick={goBackStep}>{t('onboarding.tour.ai_connect')}</Button>
    </div>
  {/if}
{/if}

<style>
  .ai-slide__field {
    display: block;
    width: 100%;
    min-height: calc(var(--font-size-md) * 5);
    padding: var(--space-4);
    border: none;
    resize: none;
    background: transparent;
    color: var(--text-primary);
    font: inherit;
    font-size: var(--font-size-md);
    outline: none;
  }
  .ai-slide__footer {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    border-top: 1px solid var(--separator);
  }
  .ai-slide__hint {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
  }
  .ai-slide__hint kbd {
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--separator);
    border-radius: var(--radius-sm);
    background: var(--bg-tertiary);
    font-family: inherit;
  }
</style>
