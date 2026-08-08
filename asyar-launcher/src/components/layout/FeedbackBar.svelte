<script lang="ts">
  import Spinner from '../base/Spinner.svelte';
  import { feedbackService } from '../../services/feedback/feedbackService.svelte';
  import { DIAGNOSTIC_MESSAGES } from '../../services/diagnostics/messages';
  import type { DiagnosticKind } from '../../services/diagnostics/kinds';
  import FeedbackDetailsDialog from '../feedback/FeedbackDetailsDialog.svelte';
  import { FeedbackMessage, KeyboardHint, StatusDot } from '../index';

  let current = $derived(feedbackService.current);
  let detailsOpen = $state(false);

  let dotColor = $derived.by<'success' | 'warning' | 'danger' | 'info'>(() => {
    switch (current?.severity) {
      case 'success':
        return 'success';
      case 'warning':
        return 'warning';
      case 'error':
      case 'fatal':
        return 'danger';
      default:
        return 'info';
    }
  });
  let message = $derived.by(() => {
    if (!current) return '';
    if (current.progress) return current.progress.title;
    const template = DIAGNOSTIC_MESSAGES[current.kind as DiagnosticKind];
    return template
      ? template(current.context ?? {})
      : (current.context.message ?? current.developerDetail ?? 'Feedback');
  });
  let showDetails = $derived(current?.severity !== 'progress');

  async function onRetry() {
    if (!current?.retryActionId) return;
    await feedbackService.triggerRetry(current.retryActionId);
    await feedbackService.dismiss(current.id);
  }

  async function onDismiss() {
    if (!current) return;
    await feedbackService.dismiss(current.id);
  }

  function onOpenDetails() {
    detailsOpen = true;
  }
</script>

{#if current}
  <div class="feedback" data-severity={current.severity}>
    {#if current.severity === 'progress'}
      <Spinner size="inline" />
    {:else}
      <StatusDot color={dotColor} />
    {/if}
    <FeedbackMessage {message} interactive={showDetails} onclick={onOpenDetails} />
    {#if current.progress?.completed != null && current.progress.total != null}
      <span class="progress-count">{current.progress.completed}/{current.progress.total}</span>
    {/if}
    {#if current.retryable && current.retryActionId}
      <button type="button" class="feedback-action" onclick={onRetry}>
        <KeyboardHint keys={['⌘', 'R']} action="Retry" />
      </button>
    {/if}
    {#if current.severity === 'error'}
      <button type="button" class="feedback-action" onclick={onDismiss}> Dismiss </button>
    {/if}
  </div>
  {#if detailsOpen}
    <FeedbackDetailsDialog bind:isOpen={detailsOpen} feedback={current} />
  {/if}
{/if}

<style>
  .feedback {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
    width: 100%;
    color: var(--text-secondary);
    font-size: var(--font-size-xs);
  }
  .feedback[data-severity='success'] {
    color: var(--accent-success);
  }
  .feedback[data-severity='warning'] {
    color: var(--accent-warning);
  }
  .feedback[data-severity='error'],
  .feedback[data-severity='fatal'] {
    color: var(--accent-danger);
  }
  .progress-count {
    flex-shrink: 0;
    color: var(--text-tertiary);
    font-variant-numeric: tabular-nums;
  }
  .feedback-action {
    flex-shrink: 0;
    border: 0;
    padding: var(--space-0-5) var(--space-1);
    border-radius: var(--radius-xs);
    background: transparent;
    color: currentColor;
    font: inherit;
    cursor: pointer;
  }
  .feedback-action:hover,
  .feedback-action:focus-visible {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }
  @media (prefers-reduced-motion: reduce) {
  }
</style>
