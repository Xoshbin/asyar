<script lang="ts">
  let { total, position }: { total: number; position: number } = $props();
</script>

<ol class="dots" aria-label={`Step ${position} of ${total}`}>
  {#each Array(total) as _, i}
    <li class:dot--active={i + 1 === position}></li>
  {/each}
</ol>

<style>
  .dots {
    display: flex;
    gap: var(--space-2);
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .dots li {
    width: 6px;
    height: 6px;
    border-radius: var(--radius-full);
    background: var(--border-color);
    transition: background var(--dur-quick) var(--ease-travel);
  }
  .dots .dot--active {
    background: var(--text-primary);
  }
</style>
