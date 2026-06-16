<script lang="ts">
  import { AppBar, Card, EmptyState, StatTile, RankedStatRow } from '../../components';
  import { usageStatsState } from './usageStatsState.svelte';

  $effect(() => {
    void usageStatsState.load();
  });

  let stats = $derived(usageStatsState.stats);
  let hasUsage = $derived(!!stats && stats.top.length > 0);
  let maxCount = $derived(stats && stats.top.length ? stats.top[0].count : 0);

  function plural(n: number, one: string, many: string): string {
    return n === 1 ? one : many;
  }
</script>

<div class="usage-view">
  <AppBar title="Usage Stats" />

  <div class="usage-body custom-scrollbar">
    {#if stats && hasUsage}
      <Card>
        <div class="usage-hero">
          <StatTile
            value={stats.totalLaunches}
            label={plural(stats.totalLaunches, 'Launch', 'Launches')}
            icon="activity"
            accent
          />
          <StatTile
            value={stats.activeDays}
            label={plural(stats.activeDays, 'Active day', 'Active days')}
            icon="history"
            divided
          />
        </div>
      </Card>

      <section class="usage-section">
        <div class="section-header">Most used</div>
        <div class="usage-list">
          {#each stats.top as item, i (item.id)}
            <RankedStatRow
              rank={i + 1}
              title={item.label ?? item.id}
              subtitle={item.label ? item.id : undefined}
              value={item.count}
              fraction={maxCount ? item.count / maxCount : 0}
            />
          {/each}
        </div>
      </section>
    {:else}
      <EmptyState
        message="No usage yet"
        description="Run some commands and your stats will appear here."
      />
    {/if}
  </div>
</div>

<style>
  .usage-view {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  .usage-body {
    display: flex;
    flex-direction: column;
    padding: var(--space-5);
    overflow-y: auto;
    flex: 1;
  }

  .usage-hero {
    display: flex;
    align-items: stretch;
    gap: var(--space-6);
  }

  .usage-section {
    display: flex;
    flex-direction: column;
  }

  .usage-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
</style>
