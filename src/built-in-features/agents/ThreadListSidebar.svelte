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

<aside class="thread-sidebar" data-no-focus-steal>
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
  <footer class="sidebar-footer">
    <kbd>↑</kbd><kbd>↓</kbd> to switch · <kbd>⌘K</kbd> for actions
  </footer>
</aside>

<style>
  .thread-sidebar {
    width: 240px;
    display: flex;
    flex-direction: column;
    border-right: 1px solid var(--border-color, #2a2a2a);
    flex-shrink: 0;
  }
  .thread-list { flex: 1; overflow-y: auto; padding: 8px 0; }
  .sidebar-footer {
    padding: 8px 12px;
    font-size: var(--font-size-xs);
    color: var(--text-tertiary);
    border-top: 1px solid var(--border-color);
    display: flex;
    gap: 4px;
    align-items: center;
    flex-wrap: wrap;
  }
  .sidebar-footer kbd {
    background: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-xs);
    padding: 1px 5px;
    font-family: var(--font-mono, monospace);
    font-size: 10px;
  }
</style>
