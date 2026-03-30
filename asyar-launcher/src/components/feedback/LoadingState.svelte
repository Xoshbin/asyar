<script lang="ts">
  let {
    message = "Loading...",
  }: {
    message?: string;
  } = $props();
</script>

<div class="loading-state">
  <div class="loading-spinner"></div>
  <div class="loading-text text-caption">{message}</div>
</div>

<style>
  .loading-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 60px 24px;
    gap: 12px;
    height: 100%;
    width: 100%;
  }

  .loading-spinner {
    width: 24px;
    height: 24px;
    border: 2px solid var(--border-color);
    border-top: 2px solid var(--accent-primary);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  .loading-text {
    color: var(--text-secondary);
  }

  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
</style>
