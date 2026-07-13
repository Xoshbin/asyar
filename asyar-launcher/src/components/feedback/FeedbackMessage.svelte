<script lang="ts">
  import { onMount } from 'svelte';
  import { getFeedbackTextMotion } from '../layout/feedbackBarMotion';

  let {
    message,
    interactive = false,
    onclick,
  }: { message: string; interactive?: boolean; onclick?: () => void } = $props();

  let viewport: HTMLElement | undefined = $state();
  let text: HTMLSpanElement | undefined = $state();
  let motion = $state<{ distancePx: number; durationMs: number } | null>(null);

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
</script>

{#snippet content()}
  <span
    class="message"
    class:scrolling={motion !== null}
    bind:this={text}
    style:--scroll-distance={`${motion?.distancePx ?? 0}px`}
    style:--scroll-duration={`${motion?.durationMs ?? 0}ms`}>{message}</span
  >
{/snippet}

{#if interactive}
  <button
    type="button"
    class="message-viewport message-trigger"
    bind:this={viewport}
    title={message}
    {onclick}
  >
    {@render content()}
  </button>
{:else}
  <div class="message-viewport" bind:this={viewport} title={message}>
    {@render content()}
  </div>
{/if}

<style>
  .message-viewport {
    min-width: 0;
    overflow: hidden;
    flex: 1;
  }
  .message-trigger {
    border: 0;
    padding: 0;
    border-radius: var(--radius-xs);
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition: background-color var(--transition-fast);
  }
  .message-trigger:hover {
    background-color: var(--bg-hover);
  }
  .message-trigger:active {
    background-color: var(--bg-selected);
  }
  .message-trigger:focus-visible {
    box-shadow: var(--shadow-focus);
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
  @media (prefers-reduced-motion: reduce) {
    .message.scrolling {
      animation: none;
    }
  }
</style>
