<script lang="ts">
  import { onMount } from 'svelte';
  import MiniLauncher, { type MiniRow } from './MiniLauncher.svelte';

  let { query, rows }: { query: string; rows: MiniRow[] } = $props();

  let typed = $state('');

  onMount(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      typed = query;
      return;
    }
    let tick = 0;
    const timer = setInterval(() => {
      tick = (tick + 1) % (query.length + 40);
      typed = query.slice(0, Math.min(tick, query.length));
    }, 80);
    return () => clearInterval(timer);
  });
</script>

<div class="mini-launcher-demo">
  <MiniLauncher query={typed} rows={typed === query ? rows : []} />
</div>

<style>
  .mini-launcher-demo {
    padding: var(--space-6);
    min-height: calc(var(--font-size-md) * 16);
  }
</style>
