<script lang="ts">
  import Modal from '../../components/base/Modal.svelte';
  import Button from '../../components/base/Button.svelte';

  let { name, sizeBytes, onDecide } = $props<{
    name: string;
    sizeBytes: number;
    onDecide: (approved: boolean) => void;
  }>();

  const sizeLabel = $derived(formatBytes(sizeBytes));

  function formatBytes(bytes: number): string {
    if (bytes <= 0) return 'an unknown size';
    const mb = bytes / (1024 * 1024);
    return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
</script>

<Modal
  isOpen={true}
  labelledBy="mcp-runtime-consent-title"
  onEscape={() => onDecide(false)}
  onEnter={() => onDecide(true)}
>
  {#snippet children()}
    <h2
      id="mcp-runtime-consent-title"
      class="text-xl font-semibold mb-4 text-[var(--text-primary)]"
    >
      Download required runtime?
    </h2>
    <p class="text-[var(--text-secondary)] mb-3">
      This MCP server needs <strong>{name}</strong> ({sizeLabel}), which isn't installed yet. Asyar
      downloads it once and reuses it for every server that needs it.
    </p>
  {/snippet}
  {#snippet actions()}
    <Button onclick={() => onDecide(false)}>Decline</Button>
    <Button autofocus onclick={() => onDecide(true)} class="btn-confirm-primary">
      Download &amp; continue
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
