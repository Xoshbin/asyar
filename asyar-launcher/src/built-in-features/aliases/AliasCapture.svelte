<script lang="ts">
  import Modal from '../../components/base/Modal.svelte';
  import { Button, Input, FormField } from '../../components';
  import ConfirmDialog from '../../components/base/ConfirmDialog.svelte';
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

  let { objectId, itemName, itemType, currentAlias, onsave, oncancel }: Props = $props();

  // svelte-ignore state_referenced_locally
  let value = $state(currentAlias ?? '');
  let error = $state<string | null>(null);
  let saving = $state(false);
  let confirmOpen = $state(false);
  let pendingAlias = $state<string | null>(null);
  let conflictName = $state<string | null>(null);

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

  async function submitAlias(): Promise<void> {
    if (saving) return;
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

  function handleFormSubmit(e: Event): void {
    e.preventDefault();
    void submitAlias();
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
</script>

<Modal isOpen={true} labelledBy="alias-capture-title" onEscape={oncancel} onEnter={submitAlias}>
  {#snippet children()}
    <form onsubmit={handleFormSubmit} class="flex flex-col gap-4">
      <div>
        <h2 id="alias-capture-title" class="text-xl font-semibold text-[var(--text-primary)]">
          {currentAlias ? 'Change alias' : 'Assign alias'}
        </h2>
        <p class="text-sm text-[var(--text-secondary)] mt-1">{itemName}</p>
      </div>

      <FormField label="Alias" hint="1–10 lowercase letters or digits" error={error ?? undefined}>
        <Input
          bind:value
          placeholder="e.g. c, s, app"
          disabled={saving}
          autocomplete="off"
          autofocus
        />
      </FormField>

      <div class="flex justify-end gap-3">
        <Button type="button" onclick={oncancel} disabled={saving}>Cancel</Button>
        <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
      </div>
    </form>
  {/snippet}
</Modal>

<ConfirmDialog
  bind:isOpen={confirmOpen}
  title="Reassign alias"
  message={conflictName ? `'${conflictName}' already uses '${pendingAlias}'. Reassign?` : ''}
  confirmButtonText="Reassign"
  cancelButtonText="Cancel"
  onconfirm={handleConfirmReassign}
  oncancel={handleCancelReassign}
/>
