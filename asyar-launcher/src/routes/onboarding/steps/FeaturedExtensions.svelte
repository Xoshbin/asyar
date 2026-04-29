<script lang="ts">
  import { onMount } from 'svelte';
  import { Card, Button, EmptyState, LoadingState } from '../../../components';
  import { advanceStep, goBackStep, fetchTopExtensions } from '../stepLogic';
  import type { ApiExtension } from '../../../built-in-features/store/state.svelte';
  import storeExtension from '../../../built-in-features/store/index.svelte';
  import { platform } from '@tauri-apps/plugin-os';

  let extensions = $state<ApiExtension[]>([]);
  let selected = $state<Set<number>>(new Set());
  let loading = $state(true);
  let installingIds = $state<Set<number>>(new Set());
  let failedIds = $state<Set<number>>(new Set());

  async function load() {
    loading = true;
    try {
      const p = platform();
      extensions = await fetchTopExtensions(5, p);
    } finally {
      loading = false;
    }
  }

  function toggle(id: number) {
    const next = new Set(selected);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    selected = next;
  }

  async function installSelected() {
    const ids = Array.from(selected);
    await Promise.allSettled(
      ids.map(async (id) => {
        installingIds = new Set([...installingIds, id]);
        try {
          const ext = extensions.find((e) => e.id === id);
          if (ext) await storeExtension.installExtension(ext.slug, ext.id, ext.name);
        } catch {
          failedIds = new Set([...failedIds, id]);
        } finally {
          const next = new Set(installingIds);
          next.delete(id);
          installingIds = next;
        }
      }),
    );
    await advanceStep();
  }

  onMount(load);
</script>

<Card>
  <h1>Try a few extensions</h1>
  <p>Optional — pick any you like and we'll install them now.</p>

  {#if loading}
    <LoadingState message="Loading…" />
  {:else if extensions.length === 0}
    <EmptyState message="Couldn't reach the extension store.">
      <Button onclick={load}>Retry</Button>
    </EmptyState>
  {:else}
    <ul class="list">
      {#each extensions as ext (ext.id)}
        <li>
          <label>
            <input
              type="checkbox"
              checked={selected.has(ext.id)}
              onchange={() => toggle(ext.id)}
              disabled={installingIds.has(ext.id)}
            />
            <span class="name">{ext.name}</span>
            {#if installingIds.has(ext.id)}<span class="hint">Installing…</span>{/if}
            {#if failedIds.has(ext.id)}<span class="error">Failed</span>{/if}
          </label>
        </li>
      {/each}
    </ul>
  {/if}

  <div class="actions">
    <Button class="btn-secondary" onclick={goBackStep}>Back</Button>
    <Button class="btn-secondary" onclick={advanceStep}>Skip</Button>
    <Button onclick={installSelected} disabled={selected.size === 0}>
      Install {selected.size} selected
    </Button>
  </div>
</Card>

<style>
  .list {
    list-style: none;
    padding: 0;
    margin: var(--space-4) 0;
  }
  .list li {
    padding: var(--space-2) 0;
  }
  .name {
    margin-left: var(--space-2);
  }
  .hint {
    margin-left: var(--space-2);
    color: var(--text-secondary);
    font-size: var(--font-size-sm);
  }
  .error {
    margin-left: var(--space-2);
    color: var(--accent-danger);
    font-size: var(--font-size-sm);
  }
  .actions {
    display: flex;
    justify-content: space-between;
    gap: var(--space-2);
    margin-top: var(--space-5);
  }
</style>
