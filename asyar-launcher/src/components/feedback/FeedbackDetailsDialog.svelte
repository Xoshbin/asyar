<script lang="ts">
  import Spinner from '../base/Spinner.svelte';
  import type { FeedbackItem } from '../../lib/ipc/commands';
  import { feedbackService } from '../../services/feedback/feedbackService.svelte';
  import { DIAGNOSTIC_MESSAGES } from '../../services/diagnostics/messages';
  import type { DiagnosticKind } from '../../services/diagnostics/kinds';
  import Button from '../base/Button.svelte';
  import Modal from '../base/Modal.svelte';

  let { isOpen = $bindable(false), feedback }: { isOpen?: boolean; feedback: FeedbackItem } =
    $props();

  let message = $derived.by(() => {
    if (feedback.progress) return feedback.progress.title;
    const template = DIAGNOSTIC_MESSAGES[feedback.kind as DiagnosticKind];
    return template
      ? template(feedback.context ?? {})
      : (feedback.context.message ?? feedback.developerDetail ?? 'Feedback');
  });
  let contextEntries = $derived(Object.entries(feedback.context ?? {}));

  async function retry() {
    if (!feedback.retryActionId) return;
    await feedbackService.triggerRetry(feedback.retryActionId);
    isOpen = false;
    await feedbackService.dismiss(feedback.id);
  }

  async function report() {
    if (!feedback.reportActionId) return;
    await feedbackService.triggerReport(feedback.reportActionId);
  }

  async function copyDetails() {
    const details = [message, feedback.developerDetail, JSON.stringify(feedback.context, null, 2)]
      .filter(Boolean)
      .join('\n\n');
    await navigator.clipboard.writeText(details);
  }
</script>

<Modal bind:isOpen title="Feedback details" width="34rem">
  {#snippet children()}
    <div class="details" data-severity={feedback.severity}>
      <p class="message">{message}</p>
      {#if feedback.progress}
        <div class="progress-row">
          <Spinner size="inline" accent />
          {#if feedback.progress.completed != null && feedback.progress.total != null}
            <span>{feedback.progress.completed} of {feedback.progress.total}</span>
          {:else}
            <span>In progress</span>
          {/if}
        </div>
      {/if}
      {#if feedback.developerDetail}
        <section>
          <h4>Technical detail</h4>
          <pre>{feedback.developerDetail}</pre>
        </section>
      {/if}
      {#if contextEntries.length > 0}
        <section>
          <h4>Context</h4>
          <dl>
            {#each contextEntries as [key, value]}
              <dt>{key}</dt>
              <dd>{value}</dd>
            {/each}
          </dl>
        </section>
      {/if}
    </div>
  {/snippet}
  {#snippet actions()}
    <Button onclick={copyDetails}>Copy details</Button>
    {#if feedback.reportActionId}<Button onclick={report}>Report</Button>{/if}
    {#if feedback.retryable && feedback.retryActionId}<Button onclick={retry}>Retry</Button>{/if}
  {/snippet}
</Modal>

<style>
  .details {
    display: grid;
    gap: var(--space-4);
  }
  .message {
    margin: 0;
    color: var(--text-primary);
    font-size: var(--font-size-md);
  }
  .progress-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--text-secondary);
  }
  section h4 {
    margin: 0 0 var(--space-2);
    color: var(--text-secondary);
    font-size: var(--font-size-xs);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  pre,
  dl {
    margin: 0;
    padding: var(--space-3);
    border-radius: var(--radius-md);
    background: var(--bg-tertiary);
    color: var(--text-secondary);
    font-size: var(--font-size-xs);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  dl {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: var(--space-1) var(--space-3);
  }
  dt {
    color: var(--text-tertiary);
  }
  dd {
    margin: 0;
    overflow-wrap: anywhere;
  }
  @media (prefers-reduced-motion: reduce) {
  }
</style>
