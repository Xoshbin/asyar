<script lang="ts">
  import AiTab from '../../settings/tabs/AiTab.svelte'
  import { onboardingService } from '../../../services/onboarding/onboardingService.svelte'
  import { diagnosticsService } from '../../../services/diagnostics/diagnosticsService.svelte'
  import { onboardingNav } from '../onboardingNav.svelte'

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
        source: 'frontend', kind: 'manual', severity: 'warning', retryable: false,
        context: { message: 'Could not skip AI setup.' }, developerDetail: String(err),
      })
    }
  }

  $effect(() => {
    onboardingNav.set({
      showSkip: true,
      skipLabel: 'Skip for now',
      onSkip: handleAiSkip,
      onPrimary: handleAiSetupDone,
    })
  })
</script>

<div class="ai-step">
  <p class="ai-step__kicker">Built-in AI</p>
  <h1 class="ai-step__title">Ask AI, right from <span class="onb-hl">the search bar</span></h1>
  <p class="ai-step__lede">
    Press <kbd>Tab</kbd> in the launcher and ask anything — answers stream right in.
    Your agents can use built-in tools (calculator, files, web search) and connect to
    external <strong>MCP</strong> servers for even more. Connect a provider below to switch it on.
  </p>
  <AiTab mode="providers-only" />
</div>

<style>
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
    margin: 0 0 var(--space-2);
    color: var(--text-secondary);
    font-size: var(--font-size-xl);
    line-height: 1.6;
  }

  .ai-step__lede kbd {
    background: var(--bg-subtle);
    border: 1px solid var(--separator);
    border-radius: var(--radius-md);
    padding: 0 6px;
    font-size: 0.9em;
  }

  .ai-step {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }
</style>
