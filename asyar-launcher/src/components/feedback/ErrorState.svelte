<script lang="ts">
  import type { Diagnostic } from 'asyar-sdk/contracts';
  import { DIAGNOSTIC_MESSAGES } from '../../services/diagnostics/messages';
  import type { DiagnosticKind } from '../../services/diagnostics/kinds';
  import { Button, Icon } from '../index';
  import { diagnosticsService } from '../../services/diagnostics/diagnosticsService.svelte';

  let { status }: { status: Diagnostic | null } = $props();

  let message = $derived.by(() => {
    if (!status) return '';
    const t = DIAGNOSTIC_MESSAGES[status.kind as DiagnosticKind];
    return t ? t(status.context ?? {}) : status.developerDetail ?? 'Error';
  });

  async function onRetry() {
    if (status?.retryable && status?.retryActionId) {
      await diagnosticsService.triggerRetry(status.retryActionId);
    }
  }
</script>

{#if status}
  <div class="error-state">
    <div class="error-state-icon">
      <Icon name="info" size={48} />
    </div>
    <div class="error-state-message text-title">{message}</div>
    {#if status.retryable && status.retryActionId}
      <div class="error-state-action">
        <Button onclick={onRetry}>Retry</Button>
      </div>
    {/if}
  </div>
{/if}

<style>
  .error-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-3);
    padding: var(--space-8);
    text-align: center;
  }

  .error-state-icon {
    color: var(--accent-danger);
  }

  .error-state-message {
    color: var(--text-primary);
  }

  .error-state-action {
    margin-top: var(--space-2);
  }
</style>
