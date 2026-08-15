<script lang="ts">
  import Modal from './Modal.svelte';
  import Button from './Button.svelte';

  let {
    title = 'Confirm Action',
    message = 'Are you sure you want to continue?',
    confirmButtonText = 'Confirm',
    cancelButtonText = 'Cancel',
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
    isOpen = false;
  }

  function cancel() {
    oncancel?.();
    isOpen = false;
  }
</script>

<Modal bind:isOpen labelledBy="confirm-dialog-title" onEscape={cancel} onEnter={confirm}>
  {#snippet children()}
    <h2 id="confirm-dialog-title" class="text-xl font-semibold mb-4 text-[var(--text-primary)]">
      {#if variant === 'danger'}
        <span class="mr-2">⚠️</span>
      {/if}
      {title}
    </h2>
    <p class="text-[var(--text-secondary)]">{message}</p>
  {/snippet}
  {#snippet actions()}
    <Button onclick={cancel}>{cancelButtonText}</Button>
    <Button autofocus onclick={confirm} class={variant === 'danger' ? 'btn-confirm-danger' : ''}>
      {confirmButtonText}
    </Button>
  {/snippet}
</Modal>

<style>
  :global(.btn-confirm-danger) {
    background: var(--accent-danger-fill) !important;
    color: var(--text-on-accent) !important;
    border: none !important;
  }

  :global(.btn-confirm-danger:hover) {
    opacity: 0.9;
  }
</style>
