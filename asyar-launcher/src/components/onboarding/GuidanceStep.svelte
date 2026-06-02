<script lang="ts">
  import Card from '../layout/Card.svelte'
  import type { Snippet } from 'svelte'

  let {
    kicker = '',
    title,
    body,
  }: {
    kicker?: string
    title: string
    body?: Snippet
  } = $props()
</script>

<Card>
  <div class="guidance">
    {#if kicker}<p class="guidance__kicker">{kicker}</p>{/if}
    <h1 class="guidance__title">{title}</h1>
    <div class="guidance__body">{@render body?.()}</div>
  </div>
</Card>

<style>
  .guidance { display: flex; flex-direction: column; gap: var(--space-3); }
  .guidance__kicker {
    font-size: var(--font-size-sm);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--asyar-brand);
    margin: 0;
  }
  .guidance__title {
    font-size: var(--font-size-display);
    font-weight: 600;
    letter-spacing: -0.5px;
    color: var(--text-primary);
    margin: 0;
  }
  .guidance__body { color: var(--text-secondary); font-size: var(--font-size-xl); line-height: 1.6; }
</style>
