<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import Button from './Button.svelte';
  import { fadeIn, popupScale } from '$lib/transitions';

  let {
    title = "Confirm Action",
    message = "Are you sure you want to continue?",
    confirmButtonText = "Confirm",
    cancelButtonText = "Cancel",
    isOpen = $bindable(false),
    onconfirm,
    oncancel,
    variant = 'default',
  }: {
    title?: string;
    message?: string;
    confirmButtonText?: string;
    cancelButtonText?: string;
    isOpen?: boolean;
    onconfirm?: () => void;
    oncancel?: () => void;
    variant?: 'default' | 'danger';
  } = $props();

  function confirm() {
    onconfirm?.();
    close();
  }

  function cancel() {
    oncancel?.();
    close();
  }

  function close() {
    isOpen = false;
  }

  function handleKeydown(event: KeyboardEvent) {
    if (!isOpen) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      cancel();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      event.stopImmediatePropagation();
      confirm();
    }
  }

  // Register in capture phase so this fires before all other keydown handlers
  onMount(() => {
    window.addEventListener('keydown', handleKeydown, true);
  });
  onDestroy(() => {
    window.removeEventListener('keydown', handleKeydown, true);
  });
</script>

{#if isOpen}
  <div
    class="fixed inset-0 dialog-backdrop flex items-center justify-center z-[200]"
    onclick={(e) => e.target === e.currentTarget && cancel()}
    role="button"
    tabindex="0"
    onkeydown={(event) => event.key === 'Enter' || event.key === ' ' ? cancel() : null}
    transition:fadeIn={{ duration: 150 }}
  >
    <div
      class="bg-[var(--bg-primary)] rounded-lg shadow-lg w-full max-w-md overflow-hidden"
      role="dialog"
      aria-modal="true"
      aria-labelledby="dialog-title"
      transition:popupScale={{ duration: 120 }}
    >
      <div class="p-6">
        <h2 id="dialog-title" class="text-xl font-semibold mb-4 text-[var(--text-primary)]">
          {#if variant === 'danger'}
            <span class="mr-2">⚠️</span>
          {/if}
          {title}
        </h2>
        <p class="text-[var(--text-secondary)] mb-6">{message}</p>

        <div class="flex justify-end gap-3">
          <Button onclick={cancel}>
            {cancelButtonText}
          </Button>
          <Button onclick={confirm} class={variant === 'danger' ? 'btn-confirm-danger' : ''}>
            {confirmButtonText}
          </Button>
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  .dialog-backdrop {
    background: rgba(0, 0, 0, 0.4);
    backdrop-filter: blur(8px);
  }

  :global(html[data-platform="linux"]) .dialog-backdrop {
    backdrop-filter: none;
    background: rgba(0, 0, 0, 0.6);
  }

  :global(.btn-confirm-danger) {
    background: var(--accent-danger) !important;
    color: white !important;
    border: none !important;
  }
  
  :global(.btn-confirm-danger:hover) {
    opacity: 0.9;
  }
</style>
