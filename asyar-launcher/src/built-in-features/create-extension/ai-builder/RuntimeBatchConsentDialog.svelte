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
      Download required runtimes?
    </h2>
    <p class="text-[var(--text-secondary)] mb-3">
      The AI Extension Builder needs the following, which {runtimes.length > 1 ? "aren't" : "isn't"} installed
      yet. Asyar downloads each once and reuses it everywhere it's needed.
    </p>
    <ul class="mb-3 list-disc pl-5 text-[var(--text-secondary)]">
      {#each runtimes as runtime (runtime.name)}
        <li><strong>{runtime.name}</strong> ({formatBytes(runtime.sizeBytes)})</li>
      {/each}
    </ul>
    <p class="text-[var(--text-secondary)] mb-3">
      Total download: <strong>{formatBytes(totalBytes)}</strong>
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
