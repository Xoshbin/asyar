<script lang="ts">
  let {
    color = "success",
    pulse = false,
    size = 8,
  }: {
    color?: "success" | "warning" | "danger" | "info";
    pulse?: boolean;
    size?: number;
  } = $props();

  const colorClass = $derived(`dot-${color}`);
</script>

<div
  class="status-dot {colorClass}"
  class:pulse
  style="--dot-size: {size}px;"
></div>

<style>
  .status-dot {
    width: var(--dot-size);
    height: var(--dot-size);
    border-radius: 50%;
    flex-shrink: 0;
  }

  .dot-success { background-color: var(--accent-success); }
  .dot-warning { background-color: var(--accent-warning); }
  .dot-danger { background-color: var(--accent-danger); }
  .dot-info { background-color: var(--accent-primary); }

  .pulse {
    animation: dot-pulse 1.5s infinite;
  }

  @keyframes dot-pulse {
    0% { transform: scale(1); opacity: 0.8; }
    50% { transform: scale(1.3); opacity: 0.4; }
    100% { transform: scale(1); opacity: 0.8; }
  }
</style>
