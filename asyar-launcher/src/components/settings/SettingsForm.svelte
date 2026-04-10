<script lang="ts">
  import type { Snippet } from 'svelte';

  let { children }: { children: Snippet } = $props();
</script>

<div class="settings-form">
  {@render children()}
</div>

<style>
  .settings-form {
    display: flex;
    flex-direction: column;
  }
</style>
