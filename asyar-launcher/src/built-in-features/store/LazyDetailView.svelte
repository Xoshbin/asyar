<script lang="ts">
  const detailViewPromise = import('./DetailView.svelte');
</script>

{#await detailViewPromise}
  <div class="flex items-center justify-center p-8 text-[var(--text-secondary)]">
    <div class="animate-pulse text-sm">Loading...</div>
  </div>
{:then module}
  {@const DetailView = module.default}
  <DetailView />
{:catch}
  <div class="p-4 text-center text-[var(--accent-danger)] text-sm font-mono">
    Failed to load view
  </div>
{/await}
