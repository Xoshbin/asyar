<script lang="ts">
  let { total, position } = $props<{ total: number; position: number }>()
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
    border-radius: 50%;
    background: var(--border-color);
  }
  .dot--active {
    background: var(--asyar-brand);
  }
</style>
