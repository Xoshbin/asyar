<script lang="ts">
  import { t } from '../../../services/i18n';
  import { Card, Button, ShortcutRecorder, TestBox } from '../../../components';
  import { advanceStep } from '../stepLogic';
  import { DEFAULT_GRAMMAR_FIX_HOTKEY } from '../../../built-in-features/agents/defaultAgent';
  import AccessibilityGate from './AccessibilityGate.svelte';
  import { agentService } from '../../../built-in-features/agents/agentService.svelte';
  import { setUpHiddenCommand } from './hiddenCommandsSetup';
  import { onboardingNav } from '../onboardingNav.svelte';

  let modifier = $state(DEFAULT_GRAMMAR_FIX_HOTKEY.modifier);
  let key = $state(DEFAULT_GRAMMAR_FIX_HOTKEY.key);
  let axGranted = $state(false);
  let configured = $state(false);
  let working = $state(false);
  let error = $state('');

  const aiReady = $derived(!!agentService.getDefaultAgent());
  const ready = $derived(configured && axGranted);

  async function recordHotkey(detail: { modifier: string; key: string }): Promise<true> {
    modifier = detail.modifier;
    key = detail.key;
    return true;
  }

  $effect(() => {
    onboardingNav.set({
      primaryLabel: configured ? t('onboarding.continue') : t('onboarding.skip'),
      onPrimary: advanceStep,
    });
  });

  async function setUp() {
    working = true;
    error = '';
    try {
      const res = await setUpHiddenCommand(modifier, key);
      configured = res.ok;
      if (!res.ok) error = res.error ?? t('onboarding.generic_error');
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      working = false;
    }
  }
</script>

<Card>
  <div class="step">
    <p class="step__kicker">{t('onboarding.hidden_kicker')}</p>
    <h1 class="step__title">
      {t('onboarding.hidden_title_pre')}
      <span class="onb-hl">{t('onboarding.hidden_title_hl')}</span>
    </h1>
    <p class="step__lede">{t('onboarding.hidden_desc')}</p>

    <div class="examples">
      <span class="examples__label">{t('onboarding.hidden_examples_label')}</span>
      <ul class="examples__list">
        <li>{t('onboarding.hidden_example_grammar')}</li>
        <li>{t('onboarding.hidden_example_translate')}</li>
        <li>{t('onboarding.hidden_example_formal')}</li>
        <li>{t('onboarding.hidden_example_summarize')}</li>
      </ul>
    </div>

    {#if !aiReady}
      <p class="step__warn">{t('onboarding.hidden_need_ai')}</p>
    {:else}
      <div class="step__setup">
        <span class="step__label"
          >{t('onboarding.step_num', { n: 1, label: t('onboarding.hidden_step_hotkey') })}</span
        >
        <ShortcutRecorder bind:modifier bind:key onsave={recordHotkey} />
        <span class="step__label"
          >{t('onboarding.step_num', { n: 2, label: t('onboarding.permission') })}</span
        >
        <AccessibilityGate bind:granted={axGranted} />
        <Button onclick={setUp} disabled={working || configured}>
          {configured
            ? t('onboarding.hidden_ready')
            : working
              ? t('onboarding.setting_up')
              : t('onboarding.step_num', { n: 3, label: t('onboarding.hidden_create') })}
        </Button>
        {#if error}<p class="step__error">{error}</p>{/if}
      </div>

      <TestBox
        label={t('onboarding.hidden_try_label')}
        prefill="i has a apple and it are very tasty"
        multiline
        enabled={ready}
        enabledHint={t('onboarding.hidden_enabled_hint', { shortcut: `${modifier}+${key}` })}
        disabledHint={t('onboarding.hidden_disabled_hint')}
      />
    {/if}
  </div>
</Card>

<style>
  .step {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .step__kicker {
    margin: 0;
    font-size: var(--font-size-sm);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--asyar-brand);
  }
  .step__title {
    margin: 0;
    font-size: var(--font-size-display);
    font-weight: 600;
    letter-spacing: -0.5px;
    color: var(--text-primary);
  }
  .step__lede {
    margin: 0;
    color: var(--text-secondary);
    font-size: var(--font-size-xl);
    line-height: 1.6;
  }
  .step__warn {
    margin: 0;
    color: var(--accent-danger);
    font-size: var(--font-size-md);
  }
  .step__setup {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .step__label {
    font-size: var(--font-size-sm);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-secondary);
  }
  .step__error {
    margin: var(--space-2) 0 0;
    color: var(--accent-danger);
    font-size: var(--font-size-md);
  }
  .examples {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .examples__label {
    font-size: var(--font-size-sm);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-secondary);
  }
  .examples__list {
    margin: 0;
    padding-left: var(--space-4);
    color: var(--text-secondary);
    font-size: var(--font-size-md);
    line-height: 1.9;
  }
</style>
