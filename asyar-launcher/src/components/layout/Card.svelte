<script>
    export let title = "";
</script>
  
<div class="bg-[var(--bg-selected)] p-6 rounded-lg mb-6 border border-[var(--border-color)] flex-shrink-0">
    {#if title}
      <h2 class="text-xl font-semibold mb-4 text-[var(--text-primary)]">{title}</h2>
    {/if}
    <slot />
</div>