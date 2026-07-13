<script lang="ts">
  import { onMount } from 'svelte';
  import { feedbackService } from '../../services/feedback/feedbackService.svelte';
  import { DIAGNOSTIC_MESSAGES } from '../../services/diagnostics/messages';
  import type { DiagnosticKind } from '../../services/diagnostics/kinds';
  import FeedbackDetailsDialog from '../feedback/FeedbackDetailsDialog.svelte';
  import { KeyboardHint, StatusDot } from '../index';
  import { getFeedbackTextMotion } from './feedbackBarMotion';

  let current = $derived(feedbackService.current);
  let detailsOpen = $state(false);
  let viewport: HTMLDivElement | undefined = $state();
  let text: HTMLSpanElement | undefined = $state();
  let motion = $state<{ distancePx: number; durationMs: number } | null>(null);

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

  function measure() {
    if (!viewport || !text) return;
    motion = getFeedbackTextMotion(text.scrollWidth, viewport.clientWidth);
  }

  onMount(() => {
    const observer = new ResizeObserver(measure);
    if (viewport) observer.observe(viewport);
    if (text) observer.observe(text);
    measure();
    return () => observer.disconnect();
  });

  $effect(() => {
    message;
    queueMicrotask(measure);
  });

  async function onRetry() {
    if (!current?.retryActionId) return;
    await feedbackService.triggerRetry(current.retryActionId);
    await feedbackService.dismiss(current.id);
  }
</script>

{#if current}
  <div class="feedback" data-severity={current.severity}>
    {#if current.severity === 'progress'}
      <span class="spinner" aria-hidden="true"></span>
    {:else}
      <StatusDot color={dotColor} />
    {/if}
    <div class="message-viewport" bind:this={viewport} title={message}>
      <span
        class="message"
        class:scrolling={motion !== null}
        bind:this={text}
        style:--scroll-distance={`${motion?.distancePx ?? 0}px`}
        style:--scroll-duration={`${motion?.durationMs ?? 0}ms`}>{message}</span
      >
    </div>
    {#if current.progress?.completed !== undefined && current.progress.total !== undefined}
      <span class="progress-count">{current.progress.completed}/{current.progress.total}</span>
    {/if}
    {#if showDetails}
      <button type="button" class="feedback-action" onclick={() => (detailsOpen = true)}>
        Details
      </button>
    {/if}
    {#if current.retryable && current.retryActionId}
      <button type="button" class="feedback-action" onclick={onRetry}>
        <KeyboardHint keys={['⌘', 'R']} action="Retry" />
      </button>
    {/if}
    {#if current.severity === 'error'}
      <button
        type="button"
        class="feedback-action"
        onclick={() => feedbackService.dismiss(current.id)}
      >
        Dismiss
      </button>
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
  .message-viewport {
    min-width: 0;
    overflow: hidden;
    flex: 1;
  }
  .message {
    display: inline-block;
    min-width: max-content;
    white-space: nowrap;
  }
  .message.scrolling {
    animation: feedback-scroll var(--scroll-duration) ease-in-out infinite;
  }
  .message-viewport:hover .message,
  .message-viewport:focus-within .message {
    animation-play-state: paused;
  }
  .progress-count {
    flex-shrink: 0;
    color: var(--text-tertiary);
    font-variant-numeric: tabular-nums;
  }
  .feedback-action {
    flex-shrink: 0;
    border: 0;
    padding: 2px 4px;
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
  .spinner {
    flex-shrink: 0;
    width: 11px;
    height: 11px;
    border: 1.5px solid currentColor;
    border-top-color: transparent;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes feedback-scroll {
    0%,
    15% {
      transform: translateX(0);
    }
    85%,
    100% {
      transform: translateX(calc(-1 * var(--scroll-distance)));
    }
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .message.scrolling,
    .spinner {
      animation: none;
    }
  }
</style>
