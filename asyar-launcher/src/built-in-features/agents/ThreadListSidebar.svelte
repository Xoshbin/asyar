<script lang="ts">
  import type { ThreadDef } from './types';
  import ListItem from '../../components/list/ListItem.svelte';
  import EmptyState from '../../components/feedback/EmptyState.svelte';

  let { threads, selectedThreadId, onSelectThread }: {
    threads: ThreadDef[];
    selectedThreadId: string | null;
    onSelectThread: (id: string) => void | Promise<void>;
  } = $props();

  function threadLabel(t: ThreadDef): string {
    const title = t.title?.trim();
    if (title) return title;
    if (t.createdAt) return new Date(t.createdAt).toLocaleString();
    return 'New thread';
  }
</script>

<aside class="thread-sidebar w-60" data-no-focus-steal>
  <div class="thread-list custom-scrollbar">
    {#if threads.length === 0}
      <EmptyState message="No threads" description="Type a message to start the first thread." />
    {:else}
      {#each threads as t (t.id)}
        <ListItem
          title={threadLabel(t)}
          selected={selectedThreadId === t.id}
          onclick={() => void onSelectThread(t.id)}
        />
      {/each}
    {/if}
  </div>
</aside>

<style>
  .thread-sidebar {
    display: flex;
    flex-direction: column;
    border-right: 1px solid var(--border-color);
    flex-shrink: 0;
  }
  .thread-list { flex: 1; overflow-y: auto; padding: var(--space-3) 0; }
</style>
