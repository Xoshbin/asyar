<script>
  import { onMount } from 'svelte';
  import { platform } from '@tauri-apps/plugin-os';
  let { children } = $props();

  onMount(async () => {
    try {
      const p = await platform(); // Ensure compatibility by wrapping in await, though often synchronous now
      document.body.dataset.platform = p;
    } catch (e) {
      console.error('Failed to get platform:', e);
    }
  });
</script>



{@render children()}
