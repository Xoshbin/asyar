<script lang="ts">
  import { crashPromptState } from '../../services/feedback/crashPromptState.svelte';
  import Button from '../base/Button.svelte';
  import Input from '../base/Input.svelte';

  let showDetails = $state(false);
</script>

{#if crashPromptState.visible && crashPromptState.payload}
  <div class="crash-prompt" role="region" aria-label="Crash report">
    <div class="crash-prompt-header">
      <span class="crash-prompt-title">Asyar crashed last time</span>
      <span class="crash-prompt-subtitle">
        Help us fix it by sending a crash report. Your email is optional.
      </span>
    </div>

    <div class="crash-prompt-email">
      <Input
        bind:value={crashPromptState.email}
        type="email"
        placeholder="Email (optional — leave blank to send anonymously)"
        disabled={crashPromptState.isSending}
      />
    </div>

    <button
      class="crash-prompt-details-toggle"
      type="button"
      onclick={() => { showDetails = !showDetails; }}
      aria-expanded={showDetails}
    >
      {showDetails ? 'Hide' : 'View exactly what will be sent'}
    </button>

    {#if showDetails}
      <pre class="text-mono custom-scrollbar crash-prompt-pre">{JSON.stringify(crashPromptState.payload, null, 2)}</pre>
    {/if}

    {#if crashPromptState.sendError}
      <p class="crash-prompt-error">{crashPromptState.sendError}</p>
    {/if}

    <div class="crash-prompt-actions">
      <Button
        onclick={() => crashPromptState.send()}
        disabled={crashPromptState.isSending}
        class="btn-primary"
      >
        {crashPromptState.isSending ? 'Sending…' : 'Send'}
      </Button>
      <Button
        onclick={() => crashPromptState.dismiss()}
        disabled={crashPromptState.isSending}
        class="btn-secondary"
      >
        Not now
      </Button>
    </div>
  </div>
{/if}

<style>
  .crash-prompt {
    position: fixed;
    bottom: calc(var(--space-10) + var(--space-3));
    left: var(--space-5);
    right: var(--space-5);
    z-index: 200;
    background: color-mix(in srgb, var(--bg-popup) 97%, transparent);
    border: 1px solid color-mix(in srgb, var(--accent-warning) 60%, transparent);
    border-radius: var(--radius-md);
    padding: var(--space-5);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    box-shadow: var(--shadow-xl);
  }

  .crash-prompt-header {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .crash-prompt-title {
    font-size: var(--font-size-md);
    font-family: var(--font-ui);
    color: var(--text-primary);
    font-weight: 600;
  }

  .crash-prompt-subtitle {
    font-size: var(--font-size-sm);
    font-family: var(--font-ui);
    color: var(--text-secondary);
  }

  .crash-prompt-email {
    width: 100%;
  }

  .crash-prompt-details-toggle {
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    font-size: var(--font-size-sm);
    font-family: var(--font-ui);
    color: var(--text-secondary);
    text-align: left;
    text-decoration: underline;
  }

  .crash-prompt-details-toggle:hover {
    color: var(--text-primary);
  }

  .crash-prompt-details-toggle:focus-visible {
    box-shadow: var(--shadow-focus);
    outline: none;
  }

  .crash-prompt-pre {
    max-height: calc(var(--space-11) * 3);
    overflow-y: auto;
    background: var(--bg-tertiary);
    border-radius: var(--radius-sm);
    padding: var(--space-3);
    margin: 0;
    white-space: pre-wrap;
    word-break: break-all;
  }

  .crash-prompt-error {
    font-size: var(--font-size-sm);
    font-family: var(--font-ui);
    color: var(--accent-danger);
    margin: 0;
  }

  .crash-prompt-actions {
    display: flex;
    gap: var(--space-3);
    flex-wrap: wrap;
  }
</style>
