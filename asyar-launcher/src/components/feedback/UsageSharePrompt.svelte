<script lang="ts">
  import { usageSharePromptState } from '../../services/feedback/usageSharePromptState.svelte';
  import Button from '../base/Button.svelte';
</script>

{#if usageSharePromptState.pendingDay}
  <div class="usage-share-prompt" role="region" aria-label="Anonymous usage share">
    <div class="usage-share-prompt-header">
      <span class="usage-share-prompt-title">Share anonymous usage?</span>
      <span class="usage-share-prompt-subtitle">
        Share anonymous usage for {usageSharePromptState.pendingDay}? Only command
        counts and your anonymous id are sent.
      </span>
    </div>

    <div class="usage-share-prompt-actions">
      <Button onclick={() => usageSharePromptState.confirm()} class="btn-primary">
        Send
      </Button>
      <Button onclick={() => usageSharePromptState.dismiss()} class="btn-secondary">
        Not now
      </Button>
    </div>
  </div>
{/if}

<style>
  .usage-share-prompt {
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

  .usage-share-prompt-header {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .usage-share-prompt-title {
    font-size: var(--font-size-md);
    font-family: var(--font-ui);
    color: var(--text-primary);
    font-weight: 600;
  }

  .usage-share-prompt-subtitle {
    font-size: var(--font-size-sm);
    font-family: var(--font-ui);
    color: var(--text-secondary);
  }

  .usage-share-prompt-actions {
    display: flex;
    gap: var(--space-3);
    flex-wrap: wrap;
  }
</style>
