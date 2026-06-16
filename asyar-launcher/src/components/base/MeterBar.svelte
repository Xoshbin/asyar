<script lang="ts">
  let {
    value = 0,
    variant = 'brand',
  }: {
    /** Fill fraction, 0..1. */
    value?: number;
    variant?: 'brand' | 'neutral';
  } = $props();

  const pct = $derived(Math.max(0, Math.min(1, value)) * 100);
</script>

<div class="meter-track">
  <div class="meter-fill {variant}" style="width: {pct}%"></div>
</div>

<style>
  .meter-track {
    width: 100%;
    height: var(--space-1);
    background: var(--bg-tertiary);
    border-radius: var(--radius-full);
    overflow: hidden;
  }

  .meter-fill {
    height: 100%;
    border-radius: var(--radius-full);
    transition: width var(--transition-smooth);
  }

  .meter-fill.brand {
    background: var(--accent-primary);
  }

  .meter-fill.neutral {
    background: var(--text-tertiary);
  }
</style>
