<script lang="ts">
  import { Icon, LauncherListRow } from '../../../../components';

  export interface MiniRow {
    icon: string;
    title: string;
    subtitle?: string;
  }

  let { query, rows }: { query: string; rows: MiniRow[] } = $props();
</script>

<div class="mini-launcher" aria-hidden="true">
  <div class="mini-launcher__search">
    <Icon name="search" size={14} />
    <span class="mini-launcher__query">{query}<span class="mini-launcher__caret"></span></span>
  </div>
  {#if rows.length}
    <div class="mini-launcher__list">
      {#each rows as row, i (row.title)}
        <LauncherListRow
          selected={i === 0}
          icon={row.icon}
          title={row.title}
          subtitle={row.subtitle}
        />
      {/each}
    </div>
  {/if}
</div>

<style>
  .mini-launcher {
    display: flex;
    flex-direction: column;
    border: 1px solid var(--separator);
    border-radius: var(--radius-lg);
    background: var(--bg-primary);
    box-shadow: var(--shadow-lg);
    overflow: hidden;
  }
  .mini-launcher__search {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-4) var(--space-5);
    color: var(--text-tertiary);
    font-size: var(--font-size-md);
  }
  .mini-launcher__query {
    color: var(--text-primary);
  }
  .mini-launcher__caret {
    display: inline-block;
    width: 1px;
    height: 1em;
    margin-left: var(--space-1);
    vertical-align: text-bottom;
    background: var(--asyar-brand);
    animation: mini-caret 1s steps(1) infinite;
  }
  .mini-launcher__list {
    padding: var(--space-1);
    border-top: 1px solid var(--separator);
    animation: mini-rows var(--dur-quick) var(--ease-emerge) both;
  }
  @keyframes mini-caret {
    50% {
      opacity: 0;
    }
  }
  @keyframes mini-rows {
    from {
      opacity: 0;
      transform: translateY(-4px);
    }
  }
</style>
