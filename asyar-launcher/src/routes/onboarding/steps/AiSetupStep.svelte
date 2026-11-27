<script lang="ts">
  import { onMount } from 'svelte';
  import AiTab from '../../settings/tabs/AiTab.svelte';
  import { onboardingService } from '../../../services/onboarding/onboardingService.svelte';
  import { settingsService } from '../../../services/settings/settingsService.svelte';
  import { feedbackService } from '../../../services/feedback/feedbackService.svelte';
  import { onboardingNav } from '../onboardingNav.svelte';
  import { aiCheckCliStatus } from '../../../lib/ipc/commands';
  import type { CliStatus } from '../../../bindings';
  import { Button, Card, ShortcutRecorder } from '../../../components';
  import { t } from '../../../services/i18n';
  import { connectCliProvider } from './aiSetup';
  import { DEFAULT_GRAMMAR_FIX_HOTKEY } from '../../../built-in-features/agents/defaultAgent';
  import AccessibilityGate from './AccessibilityGate.svelte';
  import { setUpHiddenCommand } from './hiddenCommandsSetup';

  let scanning = $state(true);
  let cliResults = $state<Record<string, CliStatus>>({});
  let connecting = $state<string | null>(null);
  let showManual = $state(false);

  // A failed probe is reported as "not installed" rather than surfaced:
  // onboarding offers manual setup below when nothing is detected.
  const CLI_STATUS_UNAVAILABLE: CliStatus = {
    installed: false,
    path: null,
    version: null,
    error: null,
    account: null,
  };

  const CLI_SPECS = [
    {
      id: 'openai',
      name: 'OpenAI Codex CLI',
      binary: 'codex',
      defaultModel: 'gpt-5-codex',
      fallbackModel: 'gpt-5-codex',
      icon: '✦',
    },
    {
      id: 'google',
      name: 'Google Antigravity CLI',
      binary: 'agy',
      defaultModel: 'gemini-2.5-pro',
      fallbackModel: 'gemini-2.5-pro',
      icon: '▲',
    },
    {
      id: 'anthropic',
      name: 'Claude Code CLI',
      binary: 'claude',
      defaultModel: 'sonnet',
      fallbackModel: 'sonnet',
      icon: '✳',
    },
  ] as const;

  const detectedEntries = $derived(CLI_SPECS.filter((spec) => cliResults[spec.id]?.installed));

  const hasConfiguredProvider = $derived(
    Object.values(settingsService.currentSettings.ai.providers).some((p) => p?.enabled === true),
  );

  function isCliConnected(providerId: string): boolean {
    const config = settingsService.currentSettings.ai.providers[providerId];
    return config?.enabled === true && config?.connectionMode === 'cli';
  }

  async function checkAllClis() {
    scanning = true;
    try {
      const [openaiStatus, googleStatus, anthropicStatus] = await Promise.all([
        aiCheckCliStatus('openai').catch(() => CLI_STATUS_UNAVAILABLE),
        aiCheckCliStatus('google').catch(() => CLI_STATUS_UNAVAILABLE),
        aiCheckCliStatus('anthropic').catch(() => CLI_STATUS_UNAVAILABLE),
      ]);
      cliResults = {
        openai: openaiStatus,
        google: googleStatus,
        anthropic: anthropicStatus,
      };
      if (!openaiStatus.installed && !googleStatus.installed && !anthropicStatus.installed) {
        showManual = true;
      }
    } finally {
      scanning = false;
    }
  }

  async function connectCli(spec: (typeof CLI_SPECS)[number]) {
    connecting = spec.id;
    try {
      const status = cliResults[spec.id];
      await connectCliProvider(spec, status ?? { path: null });

      await onboardingService.completeAi();
    } catch (err) {
      feedbackService.report({
        source: 'frontend',
        kind: 'manual',
        severity: 'warning',
        retryable: false,
        context: { message: t('onboarding.connect_failed', { name: spec.name }) },
        developerDetail: String(err),
      });
    } finally {
      connecting = null;
    }
  }

  let grammarModifier = $state(DEFAULT_GRAMMAR_FIX_HOTKEY.modifier);
  let grammarKey = $state(DEFAULT_GRAMMAR_FIX_HOTKEY.key);
  let grammarAx = $state(false);
  let grammarReady = $state(false);
  let grammarWorking = $state(false);
  let grammarError = $state('');

  async function recordGrammarHotkey(detail: { modifier: string; key: string }): Promise<true> {
    grammarModifier = detail.modifier;
    grammarKey = detail.key;
    return true;
  }

  async function setUpGrammarFix() {
    grammarWorking = true;
    grammarError = '';
    try {
      const res = await setUpHiddenCommand(grammarModifier, grammarKey);
      grammarReady = res.ok;
      if (!res.ok) grammarError = res.error ?? t('onboarding.generic_error');
    } catch (e) {
      grammarError = e instanceof Error ? e.message : String(e);
    } finally {
      grammarWorking = false;
    }
  }

  async function handleAiSetupDone() {
    try {
      await onboardingService.completeAi();
    } catch {
      // completeAi already reports via feedbackService
    }
    await onboardingService.advance();
  }

  async function handleAiSkip() {
    try {
      await onboardingService.skipAiSetup();
    } catch (err) {
      feedbackService.report({
        source: 'frontend',
        kind: 'manual',
        severity: 'warning',
        retryable: false,
        context: { message: t('onboarding.error_skip_ai') },
        developerDetail: String(err),
      });
    }
  }

  onMount(() => {
    void checkAllClis();
  });

  // One button: skip until a provider is connected, then continue.
  $effect(() => {
    onboardingNav.set(
      hasConfiguredProvider
        ? { primaryLabel: t('onboarding.continue'), onPrimary: handleAiSetupDone }
        : { primaryLabel: t('onboarding.skip_for_now'), onPrimary: handleAiSkip },
    );
  });
</script>

<div class="ai-step">
  <div class="ai-step__header">
    <h1 class="ai-step__title">{t('onboarding.ai_step_title')}</h1>
    <p class="ai-step__lede">{t('onboarding.ai_step_lede')}</p>
  </div>

  {#if scanning}
    <Card>
      <div class="cli-scanning">
        <span class="cli-scanning-text">{t('onboarding.ai_step_scanning_clis')}</span>
      </div>
    </Card>
  {:else if detectedEntries.length > 0}
    <div class="detected-section">
      <div class="detected-cards">
        {#each detectedEntries as spec (spec.id)}
          {@const status = cliResults[spec.id]}
          {@const connected = isCliConnected(spec.id)}
          <div class="detected-card" class:is-connected={connected}>
            <div class="detected-card__main">
              <div class="detected-card__identity">
                <span class="detected-card__icon" aria-hidden="true">{spec.icon}</span>
                <div class="detected-card__names">
                  <span class="detected-card__name">{spec.name}</span>
                  <span class="detected-card__binary"><code>{spec.binary}</code></span>
                </div>
              </div>

              <div class="detected-card__meta">
                {#if status?.version}
                  <span class="detected-meta-pill">{status.version}</span>
                {/if}
                {#if status?.account?.email}
                  <span class="detected-account-pill">
                    {status.account.email}
                    {#if status.account.planType}
                      <span class="detected-plan">({status.account.planType})</span>
                    {/if}
                  </span>
                {/if}
              </div>
            </div>

            <div class="detected-card__action">
              {#if connected}
                <span class="connected-badge">{t('onboarding.ai_step_connected')}</span>
              {:else}
                <Button
                  size="small"
                  onclick={() => connectCli(spec)}
                  disabled={connecting !== null}
                >
                  {connecting === spec.id
                    ? t('onboarding.connecting')
                    : t('onboarding.ai_step_quick_connect')}
                </Button>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    </div>
  {/if}

  <div class="manual-section">
    <button
      class="manual-toggle-btn"
      onclick={() => (showManual = !showManual)}
      type="button"
      aria-expanded={showManual}
    >
      <span class="manual-chevron" aria-hidden="true">{showManual ? '▾' : '▸'}</span>
      <span>{t('onboarding.ai_step_manual_providers')}</span>
    </button>

    {#if showManual}
      <div class="manual-body">
        <AiTab mode="providers-only" />
      </div>
    {/if}
  </div>

  {#if hasConfiguredProvider}
    <div class="grammar">
      <div class="grammar__text">
        <span class="grammar__title">{t('onboarding.hidden_example_grammar')}</span>
      </div>
      <ShortcutRecorder
        bind:modifier={grammarModifier}
        bind:key={grammarKey}
        onsave={recordGrammarHotkey}
      />
      <AccessibilityGate bind:granted={grammarAx} />
      <Button onclick={setUpGrammarFix} disabled={grammarWorking || grammarReady || !grammarAx}>
        {grammarReady
          ? t('onboarding.hidden_ready')
          : grammarWorking
            ? t('onboarding.setting_up')
            : t('onboarding.hidden_create')}
      </Button>
      {#if grammarError}<p class="grammar__error">{grammarError}</p>{/if}
    </div>
  {/if}
</div>

<style>
  .grammar {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-4);
    background: var(--bg-secondary);
    border: 1px solid var(--separator);
    border-radius: var(--radius-lg);
  }
  .grammar__text {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
  }
  .grammar__title {
    font-size: var(--font-size-md);
    font-weight: 600;
    color: var(--text-primary);
  }
  .grammar__error {
    margin: 0;
    color: var(--accent-danger);
    font-size: var(--font-size-md);
  }

  .ai-step {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .ai-step__header {
    text-align: center;
  }

  .ai-step__lede {
    margin: 0 0 var(--space-2);
    font-size: var(--font-size-md);
    color: var(--text-secondary);
  }

  .ai-step__title {
    margin: 0 0 var(--space-2);
    font-size: var(--font-size-display);
    font-weight: 600;
    letter-spacing: -0.5px;
    color: var(--text-primary);
  }

  .cli-scanning {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-3);
  }

  .cli-scanning-text {
    font-size: var(--font-size-sm);
    color: var(--text-tertiary);
  }

  .detected-section {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-4);
    background: var(--bg-secondary);
    border: 1px solid var(--separator);
    border-radius: var(--radius-lg);
  }

  .detected-cards {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .detected-card {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    background: var(--bg-tertiary);
    border: 1px solid var(--separator);
    border-radius: var(--radius-md);
  }

  .detected-card.is-connected {
    border-color: var(--accent-primary);
  }

  .detected-card__main {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
  }

  .detected-card__identity {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .detected-card__icon {
    font-size: var(--font-size-sm);
    color: var(--accent-primary);
  }

  .detected-card__names {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .detected-card__name {
    font-size: var(--font-size-md);
    font-weight: 600;
    color: var(--text-primary);
  }

  .detected-card__binary code {
    font-family: var(--font-mono);
    font-size: var(--font-size-xs);
    color: var(--text-tertiary);
    background: var(--bg-secondary);
    padding: 0 var(--space-1);
    border-radius: var(--radius-xs);
  }

  .detected-card__meta {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .detected-meta-pill {
    font-family: var(--font-mono);
    font-size: var(--font-size-xs);
    color: var(--text-tertiary);
  }

  .detected-account-pill {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--font-size-xs);
    font-weight: 500;
    color: var(--accent-primary);
  }

  .detected-plan {
    font-size: var(--font-size-xs);
    color: var(--text-tertiary);
  }

  .connected-badge {
    display: inline-flex;
    align-items: center;
    padding: var(--space-1) var(--space-3);
    border-radius: var(--radius-full);
    font-size: var(--font-size-xs);
    font-weight: 600;
    color: var(--accent-success);
    background: color-mix(in srgb, var(--accent-success) 12%, transparent);
  }

  .manual-section {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin-top: var(--space-2);
  }

  .manual-toggle-btn {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    background: none;
    border: none;
    padding: var(--space-2) 0;
    font-size: var(--font-size-sm);
    font-weight: 500;
    color: var(--text-secondary);
    cursor: default;
    text-align: left;
  }

  .manual-toggle-btn:hover {
    color: var(--text-primary);
  }

  .manual-chevron {
    font-size: var(--font-size-xs);
    color: var(--text-tertiary);
  }

  .manual-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding-top: var(--space-2);
  }
</style>
