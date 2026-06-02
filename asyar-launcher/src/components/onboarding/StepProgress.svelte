<script lang="ts">
  let { total, position } = $props<{ total: number; position: number }>()
</script>

<ol class="dots" aria-label={`Step ${position} of ${total}`}>
  {#each Array(total) as _, i}
    <li class:dot--active={i + 1 === position}></li>
  {/each}
</ol>

<style>
  .dots { display: flex; gap: var(--space-2); list-style: none; padding: 0; margin: 0; align-items: center; }
  .dots li {
    width: 6px; height: 6px;
    border-radius: var(--radius-full);
    background: var(--border-color);
    transition: var(--transition-smooth);
  }
  .dot--active {
    width: 22px;
    background: var(--asyar-brand);
    box-shadow: 0 0 12px var(--asyar-brand);
  }
</style>
