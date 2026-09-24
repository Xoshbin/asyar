<script lang="ts">
  import { onMount } from 'svelte';
  import AiTab from '../../settings/tabs/AiTab.svelte';
  import { onboardingService } from '../../../services/onboarding/onboardingService.svelte';
  import { settingsService } from '../../../services/settings/settingsService.svelte';
  import { agentService } from '../../../built-in-features/agents/agentService.svelte';
  import { feedbackService } from '../../../services/feedback/feedbackService.svelte';
  import { onboardingNav } from '../onboardingNav.svelte';
  import { aiCheckCliStatus, type CliStatus } from '../../../lib/ipc/commands';
  import { Button, Card, Badge } from '../../../components';
  import { t } from '../../../services/i18n';

  let scanning = $state(true);
  let cliResults = $state<Record<string, CliStatus>>({});
  let connecting = $state<string | null>(null);
  let showManual = $state(false);

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
      defaultModel: 'claude-sonnet-4-6',
      fallbackModel: 'claude-sonnet-4-6',
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
        aiCheckCliStatus('openai').catch(() => ({ installed: false })),
        aiCheckCliStatus('google').catch(() => ({ installed: false })),
        aiCheckCliStatus('anthropic').catch(() => ({ installed: false })),
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
      const modelId = spec.defaultModel;

      await settingsService.updateSettings('ai', {
        providers: {
          ...settingsService.currentSettings.ai.providers,
          [spec.id]: {
            enabled: true,
            connectionMode: 'cli',
            cliBinaryPath: status?.path ?? undefined,
            lastModelId: modelId,
          },
        },
      });

      const defaultAgent = agentService.getDefaultAgent();
      if (defaultAgent) {
        await agentService.updateAgent(defaultAgent.id, {
          providerId: spec.id,
          modelId,
        });
      }

      await onboardingService.completeAi();
    } catch (err) {
      feedbackService.report({
        source: 'frontend',
        kind: 'manual',
        severity: 'warning',
        retryable: false,
        context: { message: `Failed to connect ${spec.name}` },
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
      skipLabel: 'Skip for now',
      onSkip: handleAiSkip,
      onPrimary: handleAiSetupDone,
      primaryLabel: hasConfiguredProvider ? 'Continue' : 'Skip for now',
    });
  });
</script>

<div class="ai-step">
  <div class="ai-step__header">
    <p class="ai-step__kicker">{t('onboarding.ai_step_kicker')}</p>
    <h1 class="ai-step__title">{t('onboarding.ai_step_title')}</h1>
    <p class="ai-step__lede">
      {t('onboarding.ai_step_lede')}
    </p>
  </div>

  <div class="superpowers-grid">
    <div class="superpower-card">
      <div class="superpower-card__header">
        <span class="superpower-icon" aria-hidden="true">⚡️</span>
        <span class="superpower-title">{t('onboarding.ai_step_feature_zero_key')}</span>
      </div>
      <p class="superpower-desc">{t('onboarding.ai_step_cli_detected_sub')}</p>
    </div>
    <div class="superpower-card">
      <div class="superpower-card__header">
        <span class="superpower-icon" aria-hidden="true">🌐</span>
        <span class="superpower-title">{t('onboarding.ai_step_feature_web_search')}</span>
      </div>
      <p class="superpower-desc">{t('onboarding.ai_step_feature_web_search_desc')}</p>
    </div>
    <div class="superpower-card">
      <div class="superpower-card__header">
        <span class="superpower-icon" aria-hidden="true">🔌</span>
        <span class="superpower-title">{t('onboarding.ai_step_feature_mcp')}</span>
      </div>
      <p class="superpower-desc">{t('onboarding.ai_step_feature_mcp_desc')}</p>
    </div>
  </div>

  {#if scanning}
    <Card>
      <div class="cli-scanning">
        <span class="cli-scanning-text">{t('onboarding.ai_step_scanning_clis')}</span>
      </div>
    </Card>
  {:else if detectedEntries.length > 0}
    <div class="detected-section">
      <div class="detected-section__header">
        <div class="detected-badge-wrapper">
          <span class="detected-live-dot" aria-hidden="true"></span>
          <span class="detected-kicker">{t('onboarding.ai_step_cli_detected_badge')}</span>
          <Badge text={t('common.experimental')} variant="warning" />
        </div>
        <p class="detected-desc">{t('onboarding.ai_step_cli_detected_sub')}</p>
      </div>

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
                  {connecting === spec.id ? 'Connecting...' : t('onboarding.ai_step_quick_connect')}
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
</div>

<style>
  .ai-step {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .ai-step__kicker {
    margin: 0;
    font-size: var(--font-size-sm);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--asyar-brand);
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
    font-size: var(--font-size-xl);
    line-height: 1.6;
  }

  .superpowers-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--space-3);
  }

  .superpower-card {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-3);
    background: var(--bg-secondary);
    border: 1px solid var(--separator);
    border-radius: var(--radius-md);
  }

  .superpower-card__header {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .superpower-icon {
    font-size: var(--font-size-md);
  }

  .superpower-title {
    font-size: var(--font-size-sm);
    font-weight: 600;
    color: var(--text-primary);
  }

  .superpower-desc {
    margin: 0;
    font-size: var(--font-size-xs);
    line-height: 1.4;
    color: var(--text-secondary);
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

  .detected-badge-wrapper {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .detected-live-dot {
    width: var(--size-xs);
    height: var(--size-xs);
    border-radius: var(--radius-full);
    background: var(--accent-success);
  }

  .detected-kicker {
    font-size: var(--font-size-sm);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-primary);
  }

  .detected-desc {
    margin: var(--space-1) 0 0;
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
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
    cursor: pointer;
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
