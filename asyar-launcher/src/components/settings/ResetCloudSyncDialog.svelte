<script lang="ts">
  import { t } from '../../services/i18n';
  import Modal from '../base/Modal.svelte';
  import { Button } from '../index';
  import { syncEncryptionService } from '../../services/sync/syncEncryptionService.svelte';
  import { cloudSyncService } from '../../services/sync/cloudSyncService.svelte';
  import { logService } from '../../services/log/logService';

  let {
    isOpen = $bindable(false),
    onComplete,
    onCancel,
  }: {
    isOpen?: boolean;
    onComplete?: () => void;
    onCancel?: () => void;
  } = $props();

  let isResetting = $state(false);
  let errorMessage = $state<string | null>(null);

  function cancel() {
    if (isResetting) return;
    isOpen = false;
    errorMessage = null;
    onCancel?.();
  }

  async function handleReset() {
    if (isResetting) return;
    isResetting = true;
    errorMessage = null;
    try {
      await syncEncryptionService.reset();
      await cloudSyncService.syncNow();
      isOpen = false;
      onComplete?.();
    } catch (err) {
      logService.error(`Reset Cloud Sync failed: ${String(err)}`);
      errorMessage = String(err);
    } finally {
      isResetting = false;
    }
  }
</script>

<Modal bind:isOpen labelledBy="reset-dialog-title" width="30rem" onEscape={cancel}>
  {#snippet children()}
    <h2 id="reset-dialog-title" class="dialog-title">
      {t('settings.e2ee.reset_title')}
    </h2>
    <p class="dialog-body">
      {t('settings.e2ee.reset_body')}
    </p>

    {#if errorMessage}
      <div class="error-banner">{errorMessage}</div>
    {/if}

    <div class="dialog-actions">
      <Button disabled={isResetting} onclick={cancel}>
        {t('common.cancel')}
      </Button>
      <Button class="btn-danger" disabled={isResetting} onclick={handleReset}>
        {isResetting ? t('settings.e2ee.resetting') : t('settings.e2ee.reset_confirm_btn')}
      </Button>
    </div>
  {/snippet}
</Modal>

<style>
  .dialog-title {
    font-size: var(--font-size-xl);
    font-weight: 600;
    margin-bottom: var(--space-2);
    color: var(--text-primary);
    font-family: var(--font-ui);
  }

  .dialog-body {
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
    margin-bottom: var(--space-4);
    font-family: var(--font-ui);
    line-height: 1.5;
  }

  .dialog-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
    margin-top: var(--space-4);
  }

  .error-banner {
    background: color-mix(in srgb, var(--accent-danger) 15%, transparent);
    color: var(--accent-danger);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-sm);
    font-size: var(--font-size-sm);
    font-family: var(--font-ui);
    margin-bottom: var(--space-3);
  }

  :global(.btn-danger) {
    background: var(--accent-danger-fill) !important;
    color: var(--text-on-accent) !important;
    border-color: transparent !important;
  }

  :global(.btn-danger:hover:not(:disabled)) {
    opacity: 0.9;
  }

  :global(.btn-danger:disabled) {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
