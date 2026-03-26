<script>
  import { onMount } from 'svelte';
  import { platform } from '@tauri-apps/plugin-os';
  import { logService } from '../services/log/logService';
  let { children } = $props();

  onMount(async () => {
    try {
      const p = await platform(); // Ensure compatibility by wrapping in await, though often synchronous now
      document.documentElement.dataset.platform = p;
    } catch (e) {
      logService.error('Failed to get platform:', e);
    }
  });
</script>



{@render children()}
