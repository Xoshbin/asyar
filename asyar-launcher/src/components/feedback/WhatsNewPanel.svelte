<script lang="ts">
  import { openUrl } from '@tauri-apps/plugin-opener';
  import ModalOverlay from '../layout/ModalOverlay.svelte';
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

<ModalOverlay title="What's New in v{version}">
  {#snippet children()}
    <p class="description">Asyar has been updated. See what changed in this release.</p>
  {/snippet}
  {#snippet actions()}
    <Button onclick={() => openUrl(releaseNotesUrl)}>View Release Notes</Button>
    <Button onclick={onDismiss}>Dismiss</Button>
  {/snippet}
</ModalOverlay>

<style>
  .description {
    color: var(--text-secondary);
    font-size: var(--font-size-sm);
    font-family: var(--font-ui);
    text-align: center;
    margin: 0;
  }
</style>
