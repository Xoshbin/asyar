<script lang="ts">
  /**
   * The one spinner in the app. Three sizes cover every use we have:
   * `inline` sits next to a line of text, `sm` next to a control, `md` is the
   * one LoadingState centres in an empty view.
   *
   * By default it takes its colour from `currentColor`, so it inherits the
   * text colour of whatever it sits beside. Pass `accent` when it stands on
   * its own and should read as activity rather than as part of a sentence.
   */
  let {
    size = 'md',
    accent = false,
    label,
  }: {
    size?: 'inline' | 'sm' | 'md';
    accent?: boolean;
    /**
     * Announced to screen readers. Omit for a spinner that sits beside text
     * already describing the wait — the text carries the meaning and a second
     * announcement is just noise.
     */
    label?: string;
  } = $props();
</script>

<span
  class="spinner spinner--{size}"
  class:accent
  role={label ? 'status' : undefined}
  aria-label={label}
  aria-hidden={label ? undefined : true}
></span>

<style>
  .spinner {
    display: inline-block;
    flex-shrink: 0;
    border-style: solid;
    border-color: currentColor;
    border-top-color: transparent;
    border-radius: var(--radius-full);
    animation: spin 0.8s linear infinite;
  }

  .spinner.accent {
    border-color: var(--border-color);
    border-top-color: var(--accent-primary);
  }

  .spinner--inline {
    width: var(--size-xs);
    height: var(--size-xs);
    border-width: 1.5px;
  }

  .spinner--sm {
    width: var(--size-sm);
    height: var(--size-sm);
    border-width: 2px;
  }

  .spinner--md {
    width: var(--size-lg);
    height: var(--size-lg);
    border-width: 2px;
  }

  @keyframes spin {
    0% {
      transform: rotate(0deg);
    }
    100% {
      transform: rotate(360deg);
    }
  }

  /* Honour the OS "reduce motion" setting — the spinner still shows as a
     static ring so the waiting state stays visible. */
  @media (prefers-reduced-motion: reduce) {
    .spinner {
      animation: none;
    }
  }
</style>
