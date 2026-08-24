<script lang="ts">
  import { inspectorStore, type RuntimeEntry } from '../../services/dev/inspectorStore.svelte';
  import Badge from '../base/Badge.svelte';
  import EmptyState from '../feedback/EmptyState.svelte';
  import TimestampRelative from './TimestampRelative.svelte';
  import { t } from '../../services/i18n';

  const entries = $derived(inspectorStore.entriesForSelected());

  function entryFor(role: 'worker' | 'view'): RuntimeEntry | null {
    return entries.find((e) => e.role === role) ?? null;
  }

  /** Runtime lifecycle state → the Badge variant that carries the same meaning. */
  function stateVariant(state: string): 'default' | 'success' | 'warning' | 'danger' {
    if (state === 'ready') return 'success';
    if (state === 'mounting') return 'warning';
    if (state === 'degraded') return 'danger';
    return 'default';
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
    <EmptyState compact message={t('dev.select_extension')} />
  {:else}
    <section class="role-block">
      <header>
        <h3>Worker</h3>
        <Badge
          text={worker?.state ?? 'dormant'}
          variant={stateVariant(worker?.state ?? 'dormant')}
          mono
        />
      </header>
      <dl>
        <div>
          <dt>Mount token</dt>
          <dd>{worker?.mountToken ?? '—'}</dd>
        </div>
        <div>
          <dt>Mailbox</dt>
          <dd>{worker?.mailboxLen ?? 0}</dd>
        </div>
        <div>
          <dt>Strikes</dt>
          <dd>{worker?.strikes ?? 0}</dd>
        </div>
        <div>
          <dt>Last update</dt>
          <dd>
            {#if worker}<TimestampRelative timestamp={worker.updatedAt} />{:else}—{/if}
          </dd>
        </div>
      </dl>
      <div class="actions">
        <button type="button" class="remount-btn" onclick={handleRemount}>Force Remount</button>
      </div>
    </section>

    <section class="role-block">
      <header>
        <h3>View</h3>
        <Badge
          text={view?.state ?? 'dormant'}
          variant={stateVariant(view?.state ?? 'dormant')}
          mono
        />
      </header>
      <dl>
        <div>
          <dt>Mount token</dt>
          <dd>{view?.mountToken ?? '—'}</dd>
        </div>
        <div>
          <dt>Mailbox</dt>
          <dd>{view?.mailboxLen ?? 0}</dd>
        </div>
        <div>
          <dt>Strikes</dt>
          <dd>{view?.strikes ?? 0}</dd>
        </div>
        <div>
          <dt>Last update</dt>
          <dd>
            {#if view}<TimestampRelative timestamp={view.updatedAt} />{:else}—{/if}
          </dd>
        </div>
      </dl>
    </section>
  {/if}
</div>

<style>
  .runtime-panel {
    padding: var(--space-5);
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
  }
  .role-block {
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    padding: var(--space-4) var(--space-5);
    background: var(--bg-secondary);
  }
  .role-block header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: var(--space-4);
  }
  .role-block h3 {
    margin: 0;
    font-size: var(--font-size-xs);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-secondary);
  }
  dl {
    margin: 0;
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: var(--space-2) var(--space-5);
  }
  dl > div {
    display: flex;
    justify-content: space-between;
    font-size: var(--font-size-xs);
  }
  dt {
    color: var(--text-secondary);
  }
  dd {
    margin: 0;
    font-family: var(--font-mono);
    color: var(--text-primary);
  }
  .actions {
    margin-top: var(--space-4);
  }
  .remount-btn {
    padding: var(--space-1) var(--space-4);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-xs);
    background: var(--bg-tertiary);
    color: var(--text-primary);
    font-size: var(--font-size-xs);
    cursor: pointer;
  }
  .remount-btn:hover {
    background: var(--bg-hover);
  }
</style>
