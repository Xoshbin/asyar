<script lang="ts">
  import Spinner from '../base/Spinner.svelte';
  let {
    message = 'Loading...',
  }: {
    message?: string;
  } = $props();
</script>

<div class="loading-state">
  <Spinner accent />
  <div class="loading-text text-caption">{message}</div>
</div>

<style>
  .loading-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: var(--space-11) var(--space-8);
    gap: var(--space-5);
    height: 100%;
    width: 100%;
  }

  .loading-text {
    color: var(--text-secondary);
  }
</style>
