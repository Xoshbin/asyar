<script lang="ts">
  import { AppBar, Card, EmptyState, StatTile, RankedStatRow } from '../../components';
  import { usageStatsState } from './usageStatsState.svelte';
  import { t } from '../../services/i18n';

  $effect(() => {
    void usageStatsState.load();
  });

  let stats = $derived(usageStatsState.stats);
  let hasUsage = $derived(!!stats && stats.top.length > 0);
  let maxCount = $derived(stats && stats.top.length ? stats.top[0].count : 0);
  let aiUsage = $derived(usageStatsState.aiUsage);
  let maxTokens = $derived(
    aiUsage?.byModel[0]
      ? aiUsage.byModel[0].totals.inputTokens + aiUsage.byModel[0].totals.outputTokens
      : 0,
  );

  function plural(n: number, one: string, many: string): string {
    return n === 1 ? one : many;
  }
</script>

<div class="usage-view">
  <AppBar title={t('features.usage_stats.ui.title')} />

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
        <div class="section-header">{t('features.usage_stats.ui.most_used')}</div>
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
        message={t('features.usage_stats.no_usage')}
        description={t('features.usage_stats.no_usage_description')}
      />
    {/if}

    {#if aiUsage}
      <section class="usage-section">
        <div class="section-header">{t('features.usage_stats.ui.ai_tokens_30_days')}</div>
        <Card>
          <div class="usage-hero">
            <StatTile
              value={aiUsage.totals.inputTokens}
              label={t('features.usage_stats.ui.ai_input')}
            />
            <StatTile
              value={aiUsage.totals.outputTokens}
              label={t('features.usage_stats.ui.ai_output')}
              divided
            />
            <StatTile
              value={(aiUsage.totals.cacheReadTokens ?? 0) + (aiUsage.totals.cacheWriteTokens ?? 0)}
              label={t('features.usage_stats.ui.ai_cache')}
              divided
            />
          </div>
        </Card>
        <div class="usage-list">
          {#each aiUsage.byModel as item, i (`${item.providerId}:${item.modelId}`)}
            <RankedStatRow
              rank={i + 1}
              title={`${item.providerId} · ${item.modelId}`}
              value={item.totals.inputTokens + item.totals.outputTokens}
              fraction={maxTokens
                ? (item.totals.inputTokens + item.totals.outputTokens) / maxTokens
                : 0}
            />
          {/each}
        </div>
      </section>
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
    gap: var(--space-6);
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
