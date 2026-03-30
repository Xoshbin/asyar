<script lang="ts">
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
  }: {
    title?: string;
    message?: string;
    confirmButtonText?: string;
    cancelButtonText?: string;
    isOpen?: boolean;
    onconfirm?: () => void;
    oncancel?: () => void;
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
    if (event.key === 'Escape' && isOpen) {
      cancel();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if isOpen}
  <div
    class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
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
          {title}
        </h2>
        <p class="text-[var(--text-secondary)] mb-6">{message}</p>

        <div class="flex justify-end gap-3">
          <Button onclick={cancel}>
            {cancelButtonText}
          </Button>
          <Button onclick={confirm}>
            {confirmButtonText}
          </Button>
        </div>
      </div>
    </div>
  </div>
{/if}
