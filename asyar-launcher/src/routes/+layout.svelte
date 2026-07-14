<script lang="ts">
  import { onMount, type Component, type Snippet } from 'svelte';

  let { children }: { children: Snippet } = $props();
  let isHud = $state(false);
  let AppShell = $state<Component<{ children: Snippet }> | null>(null);

  onMount(() => {
    if (window.location.pathname === '/hud') {
      isHud = true;
      return;
    }

    void import('../components/layout/AppShell.svelte').then(({ default: component }) => {
      AppShell = component;
    });
  });
</script>

{#if isHud}
  {@render children()}
{:else if AppShell}
  <AppShell {children} />
{/if}
