<script lang="ts">
  import Modal from '../../../components/base/Modal.svelte';
  import Button from '../../../components/base/Button.svelte';
  import type { MissingRuntime } from '../../../lib/ipc/extensionBuilderCommands';
  import { t } from '../../../services/i18n';

  let { runtimes, onDecide } = $props<{
    runtimes: MissingRuntime[];
    onDecide: (approved: boolean) => void;
  }>();

  const totalBytes = $derived(
    runtimes.reduce((sum: number, r: MissingRuntime) => sum + r.sizeBytes, 0),
  );

  function formatBytes(bytes: number): string {
    if (bytes <= 0) return 'an unknown size';
    const mb = bytes / (1024 * 1024);
    return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
</script>

<Modal
  isOpen={true}
  labelledBy="ext-builder-runtime-consent-title"
  onEscape={() => onDecide(false)}
  onEnter={() => onDecide(true)}
>
  {#snippet children()}
    <h2
      id="ext-builder-runtime-consent-title"
      class="text-xl font-semibold mb-4 text-[var(--text-primary)]"
    >
      {t('features.create_extension.ui.runtimes_title')}
    </h2>
    <p class="text-[var(--text-secondary)] mb-3">
      {t(
        runtimes.length > 1
          ? 'features.create_extension.ui.runtimes_desc_other'
          : 'features.create_extension.ui.runtimes_desc_one',
      )}
    </p>
    <ul class="mb-3 list-disc pl-5 text-[var(--text-secondary)]">
      {#each runtimes as runtime (runtime.name)}
        <li><strong>{runtime.name}</strong> ({formatBytes(runtime.sizeBytes)})</li>
      {/each}
    </ul>
    <p class="text-[var(--text-secondary)] mb-3">
      {t('features.create_extension.ui.runtimes_total')} <strong>{formatBytes(totalBytes)}</strong>
    </p>
  {/snippet}
  {#snippet actions()}
    <Button onclick={() => onDecide(false)}>{t('common.decline')}</Button>
    <Button autofocus onclick={() => onDecide(true)} class="btn-confirm-primary">
      {t('common.download_and_continue')}
    </Button>
  {/snippet}
</Modal>

<style>
  :global(.btn-confirm-primary) {
    background: var(--accent-primary-fill) !important;
    color: var(--text-on-accent) !important;
    border: none !important;
  }

  :global(.btn-confirm-primary:hover) {
    opacity: 0.9;
  }
</style>
