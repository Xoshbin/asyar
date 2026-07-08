<script lang="ts">
  import { openUrl } from '@tauri-apps/plugin-opener';
  import Modal from '../base/Modal.svelte';
  import Button from '../base/Button.svelte';

  let {
    version,
    onDismiss,
  }: {
    version: string;
    onDismiss: () => void;
  } = $props();

  const releaseNotesUrl = `https://github.com/Xoshbin/asyar-launcher/releases/tag/v${version}`;
</script>

<Modal isOpen={true} title="What's New in v{version}" onEscape={onDismiss} onEnter={onDismiss}>
  {#snippet children()}
    <p class="description">Asyar has been updated. See what changed in this release.</p>
  {/snippet}
  {#snippet actions()}
    <Button onclick={() => openUrl(releaseNotesUrl)}>View Release Notes</Button>
    <Button autofocus onclick={onDismiss}>Dismiss</Button>
  {/snippet}
</Modal>

<style>
  .description {
    color: var(--text-secondary);
    font-size: var(--font-size-sm);
    font-family: var(--font-ui);
    text-align: center;
    margin: 0;
  }
</style>
