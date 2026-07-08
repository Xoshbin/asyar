<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { Snippet } from 'svelte';
  import { isActionableElementFocused, getFirstFocusable } from './Modal.logic';

  let {
    isOpen = $bindable(false),
    dismissible = true,
    labelledBy,
    title = undefined,
    subtitle = undefined,
    width = '28rem',
    onEscape,
    onEnter,
    children,
    actions,
  }: {
    isOpen?: boolean;
    dismissible?: boolean;
    // Either pass labelledBy pointing at your own heading's id, or use the
    // title/subtitle shorthand below and let Modal render + label it.
    labelledBy?: string;
    title?: string;
    subtitle?: string;
    width?: string;
    onEscape?: () => void;
    onEnter?: () => void;
    children: Snippet;
    actions?: Snippet;
  } = $props();

  const titleId = $props.id();
  const effectiveLabelledBy = $derived(labelledBy ?? (title ? titleId : undefined));

  let dialogEl: HTMLDialogElement | undefined = $state();
  let entering = $state(false);
  let returnFocusEl: HTMLElement | null = null;

  function openDialog() {
    returnFocusEl = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    entering = true;
    dialogEl?.showModal();
    document.addEventListener('focusin', handleFocusIn);
    // Force a paint of the pre-transition state before flipping to settled —
    // otherwise opacity/transform land in the same style recalc as the
    // display:none→block change from showModal() and never animate.
    requestAnimationFrame(() => requestAnimationFrame(() => (entering = false)));
  }

  function handleFocusIn(event: FocusEvent) {
    // WebKit's native focus trap on <dialog> has a documented gap (Radix UI
    // and others hit the same thing): Tab can drop focus to document.body,
    // or briefly outside the dialog, instead of cycling correctly. Only acts
    // while THIS dialog is the active top-layer modal, so it doesn't fight a
    // nested dialog opened on top of it.
    if (!dialogEl || !dialogEl.matches(':modal')) return;
    const target = event.target;
    if (target instanceof Node && dialogEl.contains(target)) return;
    getFirstFocusable(dialogEl)?.focus();
  }

  $effect(() => {
    if (isOpen) {
      if (!dialogEl?.open) openDialog();
    } else if (dialogEl?.open) {
      dialogEl.close();
    }
  });

  function cancel() {
    if (onEscape) onEscape();
    else isOpen = false;
  }

  function handleNativeClose() {
    document.removeEventListener('focusin', handleFocusIn);
    isOpen = false;
    returnFocusEl?.focus({ preventScroll: true });
    returnFocusEl = null;
  }

  function handleCancel(event: Event) {
    // Always intercept the native close so dismissible={false} dialogs can
    // refuse it, and so dialogEl.close() (triggered by the isOpen effect
    // above) stays the single path that fires the `close` event / restores
    // focus — no separate immediate-close branch to keep in sync.
    event.preventDefault();
    if (dismissible) cancel();
  }

  function handleBackdropClick(event: MouseEvent) {
    if (dismissible && event.target === dialogEl) cancel();
  }

  function handleKeydown(event: KeyboardEvent) {
    // A modal dialog owns all keyboard input while open. Background
    // built-in features register their own unconditional `window` keydown
    // listeners (e.g. Enter-to-open-selected-item) with no awareness of an
    // open dialog — stop every keydown here so none of them leak through
    // once the event has reached the dialog.
    event.stopPropagation();
    if (event.key !== 'Enter') return;
    // No preventDefault when onEnter isn't wired: a dialog with no explicit
    // Enter action (e.g. one relying on a native <form onsubmit>) should get
    // native Enter behavior, not have it silently swallowed.
    if (!onEnter) return;
    if (isActionableElementFocused(document.activeElement)) return;
    event.preventDefault();
    onEnter?.();
  }

  onDestroy(() => {
    document.removeEventListener('focusin', handleFocusIn);
    if (dialogEl?.open) dialogEl.close();
  });
</script>

<dialog
  bind:this={dialogEl}
  class="modal"
  class:entering
  style:--modal-width={width}
  aria-labelledby={effectiveLabelledBy}
  onclose={handleNativeClose}
  oncancel={handleCancel}
  onclick={handleBackdropClick}
  onkeydown={handleKeydown}
>
  <div class="modal-panel custom-scrollbar">
    {#if title}
      <h3 id={titleId}>{title}</h3>
    {/if}
    {#if subtitle}
      <p class="modal-subtitle">{subtitle}</p>
    {/if}
    {@render children()}
    {#if actions}
      <div class="modal-actions">
        {@render actions()}
      </div>
    {/if}
  </div>
</dialog>

<style>
  dialog.modal {
    border: none;
    padding: 0;
    margin: auto;
    width: 100%;
    max-width: min(var(--modal-width), 90vw);
    max-height: 90vh;
    background: var(--bg-popup);
    border-radius: var(--radius-xl);
    box-shadow: var(--shadow-popup);
    color: var(--text-primary);
    opacity: 1;
    transform: scale(1);
    transition:
      opacity var(--transition-normal),
      transform var(--transition-normal);
  }

  dialog.modal.entering {
    opacity: 0;
    transform: scale(0.96);
  }

  dialog.modal::backdrop {
    background: rgba(0, 0, 0, 0.4);
    backdrop-filter: blur(8px);
  }

  :global(html[data-platform='linux']) dialog.modal::backdrop {
    backdrop-filter: none;
    background: rgba(0, 0, 0, 0.6);
  }

  .modal-panel {
    padding: var(--space-6);
    overflow-y: auto;
    max-height: 90vh;
  }

  .modal-panel h3 {
    margin: 0 0 16px;
    font-weight: 600;
    font-size: var(--font-size-lg);
    text-align: center;
  }

  .modal-subtitle {
    margin: -12px 0 20px;
    color: var(--text-secondary);
    font-size: var(--font-size-md);
    text-align: center;
  }

  .modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-3);
    margin-top: var(--space-6);
  }
</style>
