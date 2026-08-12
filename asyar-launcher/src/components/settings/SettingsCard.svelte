<script lang="ts">
  import type { Snippet } from 'svelte';

  let { children }: { children: Snippet } = $props();
</script>

<div class="settings-card">
  {@render children()}
</div>

<style>
  .settings-card {
    background: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-xl);
    overflow: hidden;
  }
</style>
