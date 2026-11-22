<script lang="ts">
  import { onMount } from 'svelte';
  import AiTab from '../../settings/tabs/AiTab.svelte';
  import { onboardingService } from '../../../services/onboarding/onboardingService.svelte';
  import { settingsService } from '../../../services/settings/settingsService.svelte';
  import { feedbackService } from '../../../services/feedback/feedbackService.svelte';
  import { onboardingNav } from '../onboardingNav.svelte';
  import { aiCheckCliStatus } from '../../../lib/ipc/commands';
  import type { CliStatus } from '../../../bindings';
  import { Button, Badge } from '../../../components';
  import { t } from '../../../services/i18n';
  import { connectCliProvider } from './aiSetup';

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

  $effect(() => {
    onboardingNav.set({
      showSkip: true,
      skipLabel: t('onboarding.skip_for_now'),
      onSkip: handleAiSkip,
      onPrimary: handleAiSetupDone,
      primaryLabel: hasConfiguredProvider ? t('onboarding.continue') : t('onboarding.skip_for_now'),
    });
  });
</script>

<div class="ai-step">
  <div class="ai-step__header">
    <h1 class="ai-step__title">{t('onboarding.ai_step_title')}</h1>
    <p class="ai-step__lede">{t('onboarding.ai_step_lede')}</p>
  </div>

  {#if scanning}
    <p class="cli-scanning">{t('onboarding.ai_step_scanning_clis')}</p>
  {:else if detectedEntries.length > 0}
    <div class="detected">
      <div class="detected__heading">
        <span>{t('onboarding.ai_step_cli_detected_badge')}</span>
        <Badge text={t('common.experimental')} variant="warning" />
      </div>
      {#each detectedEntries as spec (spec.id)}
        {@const status = cliResults[spec.id]}
        {@const connected = isCliConnected(spec.id)}
        <div class="detected__row" class:is-connected={connected}>
          <div class="detected__names">
            <span class="detected__name">{spec.name}</span>
            {#if status?.account?.email}
              <span class="detected__account">{status.account.email}</span>
            {/if}
          </div>
          {#if connected}
            <span class="connected-badge">{t('onboarding.ai_step_connected')}</span>
          {:else}
            <Button size="small" onclick={() => connectCli(spec)} disabled={connecting !== null}>
              {connecting === spec.id
                ? t('onboarding.connecting')
                : t('onboarding.ai_step_quick_connect')}
            </Button>
          {/if}
        </div>
      {/each}
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
</div>

<style>
  .ai-step {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .ai-step__header {
    text-align: center;
  }

  .ai-step__title {
    margin: 0 0 var(--space-2);
    font-size: var(--font-size-display);
    font-weight: 600;
    letter-spacing: -0.5px;
    color: var(--text-primary);
  }

  .ai-step__lede {
    margin: 0;
    color: var(--text-secondary);
    font-size: var(--font-size-md);
    line-height: 1.5;
  }

  .cli-scanning {
    margin: 0;
    text-align: center;
    font-size: var(--font-size-sm);
    color: var(--text-tertiary);
  }

  .detected {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .detected__heading {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--font-size-sm);
    font-weight: 600;
    color: var(--text-secondary);
  }

  .detected__row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    background: var(--bg-secondary);
    border: 1px solid var(--separator);
    border-radius: var(--radius-md);
  }

  .detected__row.is-connected {
    border-color: var(--accent-primary);
  }

  .detected__names {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    min-width: 0;
  }

  .detected__name {
    font-size: var(--font-size-md);
    font-weight: 600;
    color: var(--text-primary);
  }

  .detected__account {
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
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
