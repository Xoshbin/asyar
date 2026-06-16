<script lang="ts">
  import type { Snippet } from 'svelte';
  import MeterBar from '../base/MeterBar.svelte';

  let {
    rank,
    title,
    subtitle,
    value,
    fraction = 0,
    leading,
  }: {
    rank: number;
    title: string;
    subtitle?: string;
    value: string | number;
    /** Meter fill fraction relative to the top item, 0..1. */
    fraction?: number;
    leading?: Snippet;
  } = $props();
</script>

<div class="ranked-row">
  <div class="rank">{rank}</div>

  {#if leading}
    <div class="lead">{@render leading()}</div>
  {/if}

  <div class="content">
    <div class="row-head">
      <span class="title truncate">{title}</span>
      <span class="value">{value}</span>
    </div>
    {#if subtitle}
      <span class="subtitle truncate">{subtitle}</span>
    {/if}
    <MeterBar value={fraction} />
  </div>
</div>

<style>
  .ranked-row {
    display: flex;
    align-items: baseline;
    gap: var(--space-4);
    padding: var(--space-3) var(--space-4);
    border-radius: var(--radius-lg);
    transition: background-color var(--transition-normal);
  }

  .ranked-row:hover {
    background-color: var(--bg-hover);
  }

  .rank {
    flex-shrink: 0;
    width: var(--space-6);
    text-align: right;
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    font-size: var(--font-size-sm);
    color: var(--text-tertiary);
  }

  .lead {
    display: flex;
    align-items: center;
    flex-shrink: 0;
  }

  .content {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .row-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-3);
  }

  .title {
    min-width: 0;
    font-size: var(--font-size-base);
    font-weight: 600;
    color: var(--text-primary);
  }

  .value {
    flex-shrink: 0;
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    font-size: var(--font-size-lg);
    font-weight: 600;
    color: var(--text-primary);
  }

  .subtitle {
    font-family: var(--font-mono);
    font-size: var(--font-size-xs);
    color: var(--text-tertiary);
  }

  .truncate {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
