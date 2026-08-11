<script lang="ts">
  let {
    title,
    subtitle,
  }: {
    title: string;
    subtitle: string;
  } = $props();
</script>

<div class="pane-header">
  <div class="pane-title">{title}</div>
  <div class="pane-subtitle">{subtitle}</div>
</div>

<style>
  .pane-header {
    margin-bottom: var(--space-8);
  }

  .pane-title {
    font-size: var(--font-size-3xl);
    font-weight: 700;
    letter-spacing: -0.02em;
    color: var(--text-primary);
  }

  .pane-subtitle {
    font-size: var(--font-size-md);
    color: var(--text-secondary);
    margin-top: var(--space-1);
  }
</style>
