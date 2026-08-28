<script lang="ts">
  let { children, actions, onclick } = $props();
</script>

{#if onclick}
  <button {onclick}>{@render children?.()}</button>
{:else}
  <div>
    {@render children?.()}
    {@render actions?.()}
  </div>
{/if}
