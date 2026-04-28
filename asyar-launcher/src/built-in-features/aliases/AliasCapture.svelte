<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { Button, Input, FormField } from '../../components';
  import ConfirmDialog from '../../components/base/ConfirmDialog.svelte';
  import { fadeIn, popupScale } from '$lib/transitions';
  import { validateAlias } from './aliasValidation';
  import { aliasService } from './aliasService';
  import { aliasStore } from './aliasStore.svelte';
  import { logService } from '../../services/log/logService';

  type Props = {
    objectId: string;
    itemName: string;
    itemType: 'application' | 'command';
    currentAlias?: string;
    onsave: () => void;
    oncancel: () => void;
  };

  let {
    objectId,
    itemName,
    itemType,
    currentAlias,
    onsave,
    oncancel,
  }: Props = $props();

  // svelte-ignore state_referenced_locally
  let value = $state(currentAlias ?? '');
  let error = $state<string | null>(null);
  let saving = $state(false);
  let confirmOpen = $state(false);
  let pendingAlias = $state<string | null>(null);
  let conflictName = $state<string | null>(null);
  let inputEl = $state<HTMLInputElement | null>(null);

  function reasonMessage(reason: 'empty' | 'too-long' | 'invalid-chars'): string {
    switch (reason) {
      case 'empty':
        return 'Please enter an alias.';
      case 'too-long':
        return 'Alias must be at most 10 characters.';
      case 'invalid-chars':
        return 'Alias may only contain lowercase letters and digits.';
    }
  }

  async function commit(alias: string): Promise<void> {
    saving = true;
    try {
      const created = await aliasService.register(objectId, alias, itemName, itemType);
      aliasStore.addOptimistic(created);
      onsave();
    } catch (e) {
      logService.error(`Failed to register alias '${alias}' for ${objectId}: ${e}`);
      error = 'Failed to save alias. Please try again.';
    } finally {
      saving = false;
    }
  }

  async function handleSubmit(e: Event): Promise<void> {
    e.preventDefault();
    error = null;
    const result = validateAlias(value);
    if (!result.ok) {
      error = reasonMessage(result.reason);
      return;
    }
    const conflict = await aliasService.findConflict(result.normalized, objectId);
    if (conflict) {
      pendingAlias = result.normalized;
      conflictName = conflict.itemName;
      confirmOpen = true;
      return;
    }
    await commit(result.normalized);
  }

  function handleConfirmReassign(): void {
    if (pendingAlias) {
      const alias = pendingAlias;
      pendingAlias = null;
      conflictName = null;
      void commit(alias);
    }
  }

  function handleCancelReassign(): void {
    pendingAlias = null;
    conflictName = null;
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (confirmOpen) return; // ConfirmDialog owns the keys while it's open
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      oncancel();
    }
  }

  function handleBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) oncancel();
  }

  function handleBackdropKey(event: KeyboardEvent): void {
    if (event.key === 'Enter' || event.key === ' ') oncancel();
  }

  onMount(() => {
    window.addEventListener('keydown', handleKeydown, true);
    // Focus the input on mount so users can type immediately.
    queueMicrotask(() => inputEl?.focus());
  });

  onDestroy(() => {
    window.removeEventListener('keydown', handleKeydown, true);
  });
</script>

<div
  class="fixed inset-0 dialog-backdrop flex items-center justify-center z-[200]"
  role="button"
  tabindex="0"
  onclick={handleBackdropClick}
  onkeydown={handleBackdropKey}
  transition:fadeIn={{ duration: 150 }}
>
  <div
    class="bg-[var(--bg-primary)] rounded-lg shadow-lg w-full max-w-md overflow-hidden"
    role="dialog"
    aria-modal="true"
    aria-labelledby="alias-capture-title"
    transition:popupScale={{ duration: 120 }}
  >
    <form onsubmit={handleSubmit} class="p-6 flex flex-col gap-4">
      <div>
        <h2 id="alias-capture-title" class="text-xl font-semibold text-[var(--text-primary)]">
          {currentAlias ? 'Change alias' : 'Assign alias'}
        </h2>
        <p class="text-sm text-[var(--text-secondary)] mt-1">{itemName}</p>
      </div>

      <FormField label="Alias" hint="1–10 lowercase letters or digits" error={error ?? undefined}>
        <Input
          bind:ref={inputEl}
          bind:value
          placeholder="e.g. c, s, app"
          disabled={saving}
          autocomplete="off"
          autocapitalize="off"
          spellcheck={false}
        />
      </FormField>

      <div class="flex justify-end gap-3">
        <Button type="button" onclick={oncancel} disabled={saving}>Cancel</Button>
        <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
      </div>
    </form>
  </div>
</div>

<ConfirmDialog
  bind:isOpen={confirmOpen}
  title="Reassign alias"
  message={conflictName
    ? `'${conflictName}' already uses '${pendingAlias}'. Reassign?`
    : ''}
  confirmButtonText="Reassign"
  cancelButtonText="Cancel"
  onconfirm={handleConfirmReassign}
  oncancel={handleCancelReassign}
/>

<style>
  .dialog-backdrop {
    background: rgba(0, 0, 0, 0.4);
    backdrop-filter: blur(8px);
  }

  :global(html[data-platform="linux"]) .dialog-backdrop {
    backdrop-filter: none;
    background: rgba(0, 0, 0, 0.6);
  }
</style>
