<script lang="ts" generics="T extends { id: number }">
  // Streaming-friendly rendering primitive. Uses a keyed #each over a
  // limited tail so high-frequency channels (pomodoro's 500ms tick,
  // sdk-playground push events) don't thrash the DOM. Consumers pass a
  // render snippet to format each row.
  import type { Snippet } from 'svelte';

  type Props = {
    rows: T[];
    /** Cap visible rows; older entries scroll out of the tail. */
    tail?: number;
    /** Snippet renderer for one row. */
    row: Snippet<[T]>;
  };

  let { rows, tail = 200, row }: Props = $props();

  const visible = $derived(rows.slice(Math.max(0, rows.length - tail)));
</script>

<ol class="stream-tail">
  {#each visible as item (item.id)}
    <li>{@render row(item)}</li>
  {/each}
</ol>

<style>
  .stream-tail {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column-reverse;
    gap: var(--space-0-5);
  }
  .stream-tail li {
    font-family: var(--font-mono);
    font-size: var(--font-size-xs);
    line-height: 1.5;
    padding: var(--space-0-5) var(--space-3);
    border-bottom: 1px solid var(--border-color);
  }
</style>
