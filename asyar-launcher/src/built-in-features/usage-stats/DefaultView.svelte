<script lang="ts">
  import { AppBar, Card, ListItem, Badge, EmptyState } from '../../components';
  import { usageStatsState } from './usageStatsState.svelte';

  $effect(() => {
    void usageStatsState.load();
  });

  let stats = $derived(usageStatsState.stats);
  let hasUsage = $derived(!!stats && stats.top.length > 0);
</script>

<div class="usage-view">
  <AppBar title="Usage Stats" />

  <div class="usage-body custom-scrollbar">
    {#if stats && hasUsage}
      <Card>
        <div class="usage-summary text-title">
          {stats.totalLaunches} launches · {stats.activeDays} active days
        </div>
      </Card>

      <div class="usage-list">
        {#each stats.top as item (item.id)}
          <ListItem title={item.label ?? item.id} subtitle={item.label ? item.id : undefined}>
            {#snippet trailing()}
              <Badge text={String(item.count)} />
            {/snippet}
          </ListItem>
        {/each}
      </div>
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
    gap: var(--space-4);
    padding: var(--space-5);
    overflow-y: auto;
    flex: 1;
  }

  .usage-summary {
    color: var(--text-primary);
  }

  .usage-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
</style>
