<script lang="ts">
  import { inspectorStore, type RuntimeEntry } from '../../services/dev/inspectorStore.svelte';
  import StatusBadge from './StatusBadge.svelte';
  import TimestampRelative from './TimestampRelative.svelte';

  const entries = $derived(inspectorStore.entriesForSelected());

  function entryFor(role: 'worker' | 'view'): RuntimeEntry | null {
    return entries.find((e) => e.role === role) ?? null;
  }

  const worker = $derived(entryFor('worker'));
  const view = $derived(entryFor('view'));

  async function handleRemount() {
    const id = inspectorStore.selectedExtensionId;
    if (!id) return;
    await inspectorStore.forceRemountWorker(id);
    await inspectorStore.refreshRuntimeSnapshot();
  }
</script>

<div class="runtime-panel">
  {#if !inspectorStore.selectedExtensionId}
    <div class="empty">Select an extension from the sidebar.</div>
  {:else}
    <section class="role-block">
      <header>
        <h3>Worker</h3>
        <StatusBadge state={worker?.state ?? 'dormant'} />
      </header>
      <dl>
        <div><dt>Mount token</dt><dd>{worker?.mountToken ?? '—'}</dd></div>
        <div><dt>Mailbox</dt><dd>{worker?.mailboxLen ?? 0}</dd></div>
        <div><dt>Strikes</dt><dd>{worker?.strikes ?? 0}</dd></div>
        <div>
          <dt>Last update</dt>
          <dd>{#if worker}<TimestampRelative timestamp={worker.updatedAt} />{:else}—{/if}</dd>
        </div>
      </dl>
      <div class="actions">
        <button type="button" class="remount-btn" onclick={handleRemount}>Force Remount</button>
      </div>
    </section>

    <section class="role-block">
      <header>
        <h3>View</h3>
        <StatusBadge state={view?.state ?? 'dormant'} />
      </header>
      <dl>
        <div><dt>Mount token</dt><dd>{view?.mountToken ?? '—'}</dd></div>
        <div><dt>Mailbox</dt><dd>{view?.mailboxLen ?? 0}</dd></div>
        <div><dt>Strikes</dt><dd>{view?.strikes ?? 0}</dd></div>
        <div>
          <dt>Last update</dt>
          <dd>{#if view}<TimestampRelative timestamp={view.updatedAt} />{:else}—{/if}</dd>
        </div>
      </dl>
    </section>
  {/if}
</div>

<style>
  .runtime-panel {
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .empty {
    color: var(--color-text-muted, #888);
    font-style: italic;
  }
  .role-block {
    border: 1px solid var(--color-border, #333);
    border-radius: 5px;
    padding: 10px 12px;
    background: var(--color-surface-2, #141414);
  }
  .role-block header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 10px;
  }
  .role-block h3 {
    margin: 0;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--color-text-muted, #999);
  }
  dl {
    margin: 0;
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 6px 12px;
  }
  dl > div {
    display: flex;
    justify-content: space-between;
    font-size: 11px;
  }
  dt {
    color: var(--color-text-muted, #888);
  }
  dd {
    margin: 0;
    font-family: var(--font-mono, ui-monospace, monospace);
    color: var(--color-text, #ddd);
  }
  .actions {
    margin-top: 10px;
  }
  .remount-btn {
    padding: 4px 10px;
    border: 1px solid var(--color-border, #444);
    border-radius: 3px;
    background: var(--color-surface-3, #222);
    color: var(--color-text, #ddd);
    font-size: 11px;
    cursor: pointer;
  }
  .remount-btn:hover {
    background: var(--color-surface-hover, #2a2a2a);
  }
</style>
