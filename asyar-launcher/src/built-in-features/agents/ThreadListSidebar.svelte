<script lang="ts">
  import type { ThreadDef } from './types';
  import ListItem from '../../components/list/ListItem.svelte';
  import EmptyState from '../../components/feedback/EmptyState.svelte';
  import { t } from '../../services/i18n';

  let {
    threads,
    known,
    selectedThreadId,
    onSelectThread,
  }: {
    threads: ThreadDef[];
    /** False while the list is still loading: an empty list means nothing yet. */
    known: boolean;
    selectedThreadId: string | null;
    onSelectThread: (id: string) => void | Promise<void>;
  } = $props();

  function threadLabel(thread: ThreadDef): string {
    const title = thread.title?.trim();
    if (title) return title;
    if (thread.createdAt) return new Date(thread.createdAt).toLocaleString();
    return 'New thread';
  }
</script>

<aside class="thread-sidebar w-60" data-no-focus-steal>
  <div class="thread-list custom-scrollbar">
    {#if threads.length === 0}
      {#if known}
        <EmptyState
          message={t('features.agents.no_threads')}
          description={t('features.agents.no_threads_description')}
        />
      {/if}
    {:else}
      {#each threads as thread (thread.id)}
        <ListItem
          title={threadLabel(thread)}
          selected={selectedThreadId === thread.id}
          onclick={() => void onSelectThread(thread.id)}
        >
          {#snippet trailing()}
            {#if thread.isPinned}
              <span class="text-caption opacity-70" aria-label={t('features.agents.act.pin_thread')}
                >📌</span
              >
            {/if}
          {/snippet}
        </ListItem>
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
  .thread-list {
    flex: 1;
    overflow-y: auto;
    padding: var(--space-3) 0;
  }
</style>
