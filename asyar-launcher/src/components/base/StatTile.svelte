<script lang="ts">
  import Icon from './Icon.svelte';

  let {
    value,
    label,
    icon,
    accent = false,
    divided = false,
  }: {
    value: string | number;
    label: string;
    icon?: string;
    accent?: boolean;
    divided?: boolean;
  } = $props();
</script>

<div class="stat-tile" class:divided>
  <div class="stat-value" class:accent>{value}</div>
  <div class="stat-label">
    {#if icon}
      <Icon name={icon} size={13} />
    {/if}
    <span>{label}</span>
  </div>
</div>

<style>
  .stat-tile {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .stat-tile.divided {
    border-left: 1px solid var(--separator);
    padding-left: var(--space-6);
  }

  .stat-value {
    font-size: var(--font-size-display);
    font-weight: 600;
    line-height: 1;
    letter-spacing: -0.02em;
    color: var(--text-primary);
    font-variant-numeric: tabular-nums;
  }

  .stat-value.accent {
    color: var(--accent-primary);
  }

  .stat-label {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--font-size-xs);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-tertiary);
  }
</style>
