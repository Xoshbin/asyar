<script lang="ts">
  let {
    text,
    variant = "default",
    mono = false,
    bordered = false,
  }: {
    text: string;
    variant?: "default" | "success" | "warning" | "danger" | "info";
    mono?: boolean;
    bordered?: boolean;
  } = $props();

  const variantClass = $derived(`badge-${variant}`);
</script>

<span class="badge {variantClass}" class:mono class:bordered>
  {text}
</span>

<style>
  .badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 2px 6px;
    font-size: 10px;
    font-weight: 600;
    line-height: normal;
    border-radius: var(--radius-xs);
    white-space: nowrap;
    user-select: none;
    text-transform: uppercase;
    letter-spacing: 0.02em;
  }

  .badge-default {
    background-color: var(--bg-tertiary);
    color: var(--text-secondary);
  }

  .badge-success {
    background-color: color-mix(in srgb, var(--accent-success) 12%, transparent);
    color: var(--accent-success);
  }

  .badge-warning {
    background-color: color-mix(in srgb, var(--accent-warning) 12%, transparent);
    color: var(--accent-warning);
  }

  .badge-danger {
    background-color: color-mix(in srgb, var(--accent-danger) 12%, transparent);
    color: var(--accent-danger);
  }

  .badge-info {
    background-color: var(--asyar-brand-subtle);
    color: var(--accent-primary);
  }

  .mono {
    font-family: var(--font-mono);
  }

  .bordered {
    border: 1px solid var(--border-color);
  }
</style>
