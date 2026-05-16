<script lang="ts">
  import { Card, Button, ShortcutRecorder } from '../../../components';
  import { advanceStep, goBackStep } from '../stepLogic';
  import { agentService } from '../../../built-in-features/agents/agentService.svelte';
  import { shortcutService } from '../../../built-in-features/shortcuts/shortcutService';
  import { DEFAULT_GRAMMAR_FIX_HOTKEY } from '../../../built-in-features/agents/defaultAgent';
  import { diagnosticsService } from '../../../services/diagnostics/diagnosticsService.svelte';

  let modifier = $state(DEFAULT_GRAMMAR_FIX_HOTKEY.modifier);
  let key = $state(DEFAULT_GRAMMAR_FIX_HOTKEY.key);

  // The default Asyar Assistant carries the provider+model the user just
  // configured in the previous step. If they skipped AI setup it's null and
  // this step degrades to a "set up AI first" message instead of the picker.
  const defaultAgent = $derived(agentService.getDefaultAgent());
  const aiConfigured = $derived(!!defaultAgent);

  async function handleSave(detail: { modifier: string; key: string }): Promise<string | true> {
    // The ShortcutRecorder's "Save" only persists the picker state — actual
    // binding happens on Continue. Returning true keeps the recorder happy.
    modifier = detail.modifier;
    key = detail.key;
    return true;
  }

  async function handleContinue(): Promise<void> {
    if (!defaultAgent) {
      await advanceStep();
      return;
    }
    try {
      const agent = await agentService.seedGrammarFixAgent(
        defaultAgent.providerId,
        defaultAgent.modelId,
      );
      const objectId = `cmd_agents_dyn_${agent.id}`;
      const shortcutStr = `${modifier}+${key}`;
      const result = await shortcutService.register(
        objectId,
        agent.name,
        'command',
        shortcutStr,
        undefined,
        'icon:sparkles',
      );
      if (!result.ok && result.conflict) {
        diagnosticsService.report({
          source: 'frontend',
          kind: 'grammar_fix_hotkey_conflict',
          severity: 'warning',
          retryable: false,
          context: {
            message: `Shortcut ${shortcutStr} is already used by "${result.conflict.itemName}". You can change it later from the agent's row.`,
          },
        });
      }
    } catch (err) {
      diagnosticsService.report({
        source: 'frontend',
        kind: 'grammar_fix_seed_failed',
        severity: 'warning',
        retryable: false,
        context: {
          message:
            'Could not add the Grammar Fix command. You can create it manually from Manage Agents.',
        },
        developerDetail: String(err),
      });
    }
    await advanceStep();
  }

  async function handleSkip(): Promise<void> {
    await advanceStep();
  }
</script>

<Card>
  <h1>One-keystroke AI commands</h1>
  <p>
    We've prepared <strong>Grammar Fix</strong> — a silent AI command that takes
    the text you have selected in any app and replaces it with the corrected
    version. No window opens, no confirm dialog.
  </p>

  {#if aiConfigured}
    <div class="example">
      <div class="example__label">Try it after onboarding:</div>
      <ol class="example__steps">
        <li>Select text with a typo in TextEdit, Notes, or any editor.</li>
        <li>Press your shortcut below.</li>
        <li>The text is replaced in place.</li>
      </ol>
    </div>

    <div class="row">
      <div class="row__label">
        <span class="row__title">Shortcut for Grammar Fix</span>
        <span class="row__hint">
          You can change this later from the agent's row in the launcher.
        </span>
      </div>
      <ShortcutRecorder bind:modifier bind:key onsave={handleSave} />
    </div>

    <div class="actions">
      <Button class="btn-secondary" onclick={goBackStep}>Back</Button>
      <div class="actions__right">
        <Button class="btn-secondary" onclick={handleSkip}>Skip</Button>
        <Button onclick={handleContinue}>Add Grammar Fix</Button>
      </div>
    </div>
  {:else}
    <p class="note">
      You skipped AI setup, so we can't add Grammar Fix yet. Open
      <strong>Settings → AI</strong> later to set up a provider, then add the
      Grammar Fix command from <strong>Manage Agents</strong>.
    </p>
    <div class="actions">
      <Button class="btn-secondary" onclick={goBackStep}>Back</Button>
      <Button onclick={handleSkip}>Continue</Button>
    </div>
  {/if}
</Card>

<style>
  .example {
    background: var(--bg-subtle);
    border-radius: var(--radius-md);
    padding: var(--space-3) var(--space-4);
    margin: var(--space-4) 0;
  }
  .example__label {
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
    margin-bottom: var(--space-2);
  }
  .example__steps {
    margin: 0;
    padding-left: var(--space-5);
    font-size: var(--font-size-sm);
    color: var(--text-primary);
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-5);
    padding: var(--space-4) 0;
  }
  .row__label {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .row__title {
    font-size: var(--font-size-md);
    font-weight: 600;
    color: var(--text-primary);
  }
  .row__hint {
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
  }
  .note {
    color: var(--text-secondary);
    margin: var(--space-4) 0;
  }
  .actions {
    display: flex;
    justify-content: space-between;
    margin-top: var(--space-5);
  }
  .actions__right {
    display: flex;
    gap: var(--space-2);
  }
</style>
