<script lang="ts">
  import { onMount } from 'svelte';

  let { timestamp }: { timestamp: number } = $props();

  let now = $state(Date.now());

  function format(ms: number, asOf: number): string {
    const delta = Math.max(0, asOf - ms);
    if (delta < 1000) return 'just now';
    const s = Math.floor(delta / 1000);
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  }

  const label = $derived(format(timestamp, now));

  onMount(() => {
    const id = setInterval(() => {
      now = Date.now();
    }, 1000);
    return () => clearInterval(id);
  });
</script>

<span class="ts-rel" title={new Date(timestamp).toISOString()}>{label}</span>

<style>
  .ts-rel {
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 10px;
    color: var(--color-text-muted, #888);
  }
</style>
