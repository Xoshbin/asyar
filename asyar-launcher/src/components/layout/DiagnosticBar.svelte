<script lang="ts">
  import { diagnosticsService } from '../../services/diagnostics/diagnosticsService.svelte';
  import { DIAGNOSTIC_MESSAGES } from '../../services/diagnostics/messages';
  import type { DiagnosticKind } from '../../services/diagnostics/kinds';
  import { StatusDot, KeyboardHint } from '../index';

  let current = $derived(diagnosticsService.current);
  let dotColor = $derived.by<'success' | 'warning' | 'danger' | 'info'>(() => {
    switch (current?.severity) {
      case 'success':
      case 'info': return 'success';
      case 'warning': return 'warning';
      case 'error':
      case 'fatal': return 'danger';
      default: return 'info';
    }
  });
  let message = $derived.by(() => {
    if (!current) return '';
    const t = DIAGNOSTIC_MESSAGES[current.kind as DiagnosticKind];
    return t ? t(current.context ?? {}) : current.developerDetail ?? 'Error';
  });
  let isSticky = $derived(current?.severity === 'error' || current?.severity === 'fatal');

  async function onRetry() {
    if (current?.retryActionId) {
      await diagnosticsService.triggerRetry(current.retryActionId);
      diagnosticsService.dismiss();
    }
  }
  function onDismiss() { diagnosticsService.dismiss(); }
</script>

{#if current}
  <div class="flex items-center gap-2 min-w-0 text-xs text-[var(--text-secondary)]"
       title={current.developerDetail ?? message}>
    <StatusDot color={dotColor} />
    <span class="truncate">{message}</span>
    {#if current.retryable && current.retryActionId}
      <button type="button" class="pressable" onclick={onRetry}>
        <KeyboardHint keys={["⌘", "R"]} action="Retry" />
      </button>
    {/if}
    {#if isSticky}
      <button type="button" class="pressable" onclick={onDismiss}>
        <KeyboardHint keys="Esc" action="Dismiss" />
      </button>
    {/if}
  </div>
{/if}
